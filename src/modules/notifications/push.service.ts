/**
 * Push delivery for Habito Living.
 *
 * Two transports, no third-party SDK:
 *
 *  - **FCM HTTP v1** for Android (and iOS when APNs is not configured, in
 *    which case the APNs key is uploaded to Firebase — see
 *    docs/PUSH_NOTIFICATIONS.md).
 *  - **APNs HTTP/2** direct for iOS when `APNS_*` is configured.
 *
 * Both are fire-and-forget with a hard per-token timeout. Failures never
 * reject `notifyUsers`; a token that the provider reports as unregistered is
 * deleted so dead devices stop receiving retries.
 *
 * When credentials are absent this module is a no-op that logs once. The API
 * surface is identical either way, so shipping to production never depends on
 * the environment happening to be configured first.
 */
import { createPrivateKey, createSign, createHash } from 'node:crypto';
import https from 'node:https';
import http2 from 'node:http2';

import { pushConfig } from '../../config/env';
import { logger } from '../../common/utils/logger';
import { PushToken } from './push-token.model';

export interface PushMessage {
  title: string;
  body: string;
  /** String-map payload the app routes on (e.g. `route`, `entityId`). */
  data?: Record<string, unknown>;
}

export interface PushResult {
  attempted: number;
  delivered: number;
  failed: number;
  /** Tokens dropped because the provider says the device is gone. */
  purged: number;
  skipped: boolean;
}

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_API = 'https://fcm.googleapis.com/v1/projects';
const APNS_HOST_PROD = 'api.push.apple.com';
const APNS_HOST_SANDBOX = 'api.sandbox.push.apple.com';

let warnedDisabled = false;
function warnOnce() {
  if (warnedDisabled) return;
  warnedDisabled = true;
  logger.warn('push_disabled', {
    detail:
      'Push credentials are not configured (FCM_* and/or APNS_*). ' +
      'Notifications will be written to the inbox only. See docs/PUSH_NOTIFICATIONS.md.',
  });
}

// --------------------------------------------------------------- FCM auth

interface FcmTokenCache {
  accessToken: string;
  expiresAt: number; // epoch seconds
}
let fcmCache: FcmTokenCache | null = null;

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

/** Mint (and cache) an OAuth access token for FCM from the service account. */
async function fcmAccessToken(): Promise<string> {
  const { clientEmail, privateKey } = pushConfig.fcm;
  const now = Math.floor(Date.now() / 1000);
  if (fcmCache && fcmCache.expiresAt > now + 60) return fcmCache.accessToken;

  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: clientEmail,
    scope: FCM_SCOPE,
    aud: FCM_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer.sign(createPrivateKey(privateKey));
  const assertion = `${unsigned}.${base64url(signature)}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetch(FCM_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) {
    throw new Error(`FCM OAuth failed (${res.status}): ${json.error ?? 'no access_token in response'}`);
  }
  fcmCache = { accessToken: json.access_token, expiresAt: now + (json.expires_in ?? 3600) };
  return fcmCache.accessToken;
}

// ------------------------------------------------------------- transports

interface SendOutcome {
  ok: boolean;
  /** Provider says the token is permanently gone; drop it. */
  unregistered?: boolean;
  provider?: string;
  status?: number;
  error?: string;
}

async function sendFcm(token: string, msg: PushMessage): Promise<SendOutcome> {
  try {
    const accessToken = await fcmAccessToken();
    const projectId = pushConfig.fcm.projectId;
    const stringData = Object.fromEntries(
      Object.entries(msg.data ?? {}).map(([k, v]) => [k, String(v)]),
    );
    const res = await fetch(`${FCM_API}/${projectId}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title: msg.title, body: msg.body },
          data: stringData,
          android: { priority: 'high', notification: { channel_id: 'habito_general', sound: 'default' } },
          apns: {
            headers: { 'apns-priority': '10', 'apns-push-type': 'alert' },
            payload: { aps: { sound: 'default', 'content-available': 1 } },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 404) return { ok: false, unregistered: true, provider: 'fcm', status: 404 };
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string } };
    if (!res.ok) {
      const status = json?.error?.status;
      if (status === 'UNREGISTERED' || status === 'NOT_FOUND') {
        return { ok: false, unregistered: true, provider: 'fcm', status: res.status, error: json?.error?.message };
      }
      return { ok: false, provider: 'fcm', status: res.status, error: json?.error?.message ?? 'FCM send failed' };
    }
    return { ok: true, provider: 'fcm', status: res.status };
  } catch (err) {
    return { ok: false, provider: 'fcm', error: err instanceof Error ? err.message : String(err) };
  }
}

/** Apple .p8 is a PKCS#8 EC key on P-256; jsonwebtoken signs ES256 fine but we
 *  do it manually so this file has no extra dependency semantics. */
let apnsJwtCache: { jwt: string; iat: number } | null = null;
function apnsJwt(): string {
  const { teamId, keyId, privateKey } = pushConfig.apns;
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwtCache && apnsJwtCache.iat > now - 3300) return apnsJwtCache.jwt;

  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const claim = { iss: teamId, iat: now };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const signer = createSign('SHA256');
  signer.update(unsigned);
  const signature = signer.sign({ key: createPrivateKey(privateKey), dsaEncoding: 'ieee-p1363' });
  apnsJwtCache = { jwt: `${unsigned}.${base64url(signature)}`, iat: now };
  return apnsJwtCache.jwt;
}

function sendApns(token: string, msg: PushMessage): Promise<SendOutcome> {
  const host = pushConfig.apns.useSandbox ? APNS_HOST_SANDBOX : APNS_HOST_PROD;
  const payload = JSON.stringify({
    aps: {
      alert: { title: msg.title, body: msg.body },
      sound: 'default',
      'content-available': 1,
    },
    data: msg.data ?? {},
  });

  return new Promise<SendOutcome>((resolve) => {
    let client: http2.ClientHttp2Session | null = null;
    const timer = setTimeout(() => {
      client?.destroy();
      resolve({ ok: false, provider: 'apns', error: 'timeout' });
    }, 10_000);

    try {
      client = http2.connect(`https://${host}`);
      client.on('error', (err) => {
        clearTimeout(timer);
        resolve({ ok: false, provider: 'apns', error: err.message });
      });
      const req = client.request({
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        'apns-topic': pushConfig.apns.bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        authorization: `bearer ${apnsJwt()}`,
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      });
      let body = '';
      req.on('response', (headers) => {
        const status = Number(headers[':status'] ?? 0);
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          clearTimeout(timer);
          client?.close();
          if (status === 200) {
            resolve({ ok: true, provider: 'apns', status });
            return;
          }
          let reason: string | undefined;
          try {
            reason = (JSON.parse(body) as { reason?: string }).reason;
          } catch {
            /* keep undefined */
          }
          if (status === 410 || status === 400 || reason === 'Unregistered' || reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic') {
            resolve({ ok: false, unregistered: true, provider: 'apns', status, error: reason });
            return;
          }
          resolve({ ok: false, provider: 'apns', status, error: reason ?? `APNs ${status}` });
        });
      });
      req.on('error', (err) => {
        clearTimeout(timer);
        client?.close();
        resolve({ ok: false, provider: 'apns', error: err.message });
      });
      req.write(payload);
      req.end();
    } catch (err) {
      clearTimeout(timer);
      client?.close();
      resolve({ ok: false, provider: 'apns', error: err instanceof Error ? err.message : String(err) });
    }
  });
}

// ------------------------------------------------------------- dispatch

/**
 * Sends a push to every device registered for [userIds].
 *
 * Never throws. Returns counters; callers log and move on. When no transport
 * is configured the call is a logged no-op so behaviour is identical across
 * environments.
 */
export async function sendPushToUsers(
  userIds: string[],
  msg: PushMessage,
): Promise<PushResult> {
  const unique = [...new Set(userIds.map(String))];
  if (!unique.length) return { attempted: 0, delivered: 0, failed: 0, purged: 0, skipped: true };

  const transport = pushConfig.fcmEnabled || pushConfig.apnsEnabled;
  if (!transport) {
    warnOnce();
    return { attempted: 0, delivered: 0, failed: 0, purged: 0, skipped: true };
  }

  const tokens = (await PushToken.find({ userId: { $in: unique } }).select('token platform')) as any[];
  if (!tokens.length) {
    return { attempted: 0, delivered: 0, failed: 0, purged: 0, skipped: false };
  }

  const results = await Promise.allSettled(
    tokens.map(async (t: any) => {
      const platform = String(t.platform);
      if (platform === 'IOS') {
        if (pushConfig.apnsEnabled) return sendApns(t.token, msg);
        if (pushConfig.fcmEnabled) return sendFcm(t.token, msg);
        return { ok: false as const, provider: 'none', error: 'iOS push not configured' };
      }
      if (pushConfig.fcmEnabled) return sendFcm(t.token, msg);
      return { ok: false as const, provider: 'none', error: 'FCM not configured' };
    }),
  );

  let delivered = 0;
  let failed = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') {
      failed++;
      continue;
    }
    if (r.value.ok) delivered++;
    else failed++;
  }

  // Delete the dead tokens so future registrations stay healthy. Match by the
  // offending token, not by provider — a token is globally unique.
  const deadTokens: string[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value.unregistered) {
      deadTokens.push(tokens[i].token);
    }
  });
  if (deadTokens.length) {
    try {
      const res = await PushToken.deleteMany({ token: { $in: deadTokens } });
      logger.info('push_tokens_purged', { count: res.deletedCount });
    } catch (err) {
      logger.warn('push_purge_failed', { error: (err as Error).message });
    }
  }

  if (failed > 0) {
    logger.warn('push_partial_failure', { attempted: tokens.length, delivered, failed });
  }

  return {
    attempted: tokens.length,
    delivered,
    failed,
    purged: deadTokens.length,
    skipped: false,
  };
}

/** Test helper — not wired to any route. */
export function pushHealth() {
  return {
    fcmEnabled: pushConfig.fcmEnabled,
    apnsEnabled: pushConfig.apnsEnabled,
    iosVia: pushConfig.iosVia,
    strict: pushConfig.strict,
    // Never leak key material; only shape info.
    fcmProjectId: pushConfig.fcm.projectId ? createHash('sha256').update(pushConfig.fcm.projectId).digest('hex').slice(0, 8) : null,
  };
}
