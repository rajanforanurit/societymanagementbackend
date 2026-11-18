import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/society_management?replicaSet=rs0'),
    ENABLE_TRANSACTIONS: bool.default(true),
    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
    IMPERSONATION_MAX_MINUTES: z.coerce.number().int().default(60),
    OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_TTL_MINUTES: z.coerce.number().int().default(5),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().default(5),
    OTP_RESEND_SECONDS: z.coerce.number().int().default(30),
    // Safe default: OTPs are never exposed unless explicitly enabled
    EXPOSE_DEV_OTP: bool.default(false),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    CORS_ORIGINS: z.string().default('*'),
    UPLOAD_DIR: z.string().default('uploads'),
    MAX_UPLOAD_MB: z.coerce.number().default(5),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(900000),
    RATE_LIMIT_MAX: z.coerce.number().int().default(1000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(40),
    PAYMENT_GATEWAY: z.enum(['mock']).default('mock'),
    PAYMENT_WEBHOOK_SECRET: z.string().min(8).default('dev-payment-secret'),
    SCHEDULER_ENABLED: bool.default(true),
    SUPER_ADMIN_NAME: z.string().default('Platform Owner'),
    SUPER_ADMIN_EMAIL: z.string().default('superadmin@example.com'),
    SUPER_ADMIN_MOBILE: z.string().default('+919999999999'),
    SUPER_ADMIN_PASSWORD: z.string().default('ChangeMe@123'),
    // ---- Admin onboarding ----
    // When true, a SOCIETY_ADMIN with mustChangePassword set can only call /auth/password/change,
    // /auth/me and /auth/logout until the password is changed. Enable once the Admin app ships the
    // forced change-password screen.
    ENFORCE_ADMIN_PASSWORD_CHANGE: bool.default(false),
    // ---- Emergency alarm ----
    // A resident cannot raise a second alarm inside this window (accidental double taps).
    EMERGENCY_DEDUPE_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
    // ---- In-app calling (WebRTC signaling) ----
    CALL_RING_SECONDS: z.coerce.number().int().min(15).max(120).default(45),
    STUN_URLS: z.string().default('stun:stun.l.google.com:19302'),
    // Comma separated, e.g. turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349
    TURN_URLS: z.string().default(''),
    // coturn `static-auth-secret` (time-limited REST credentials).
    TURN_SECRET: z.string().default(''),
    TURN_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
    // ---- Push notifications (optional; push is disabled when absent) ----
    // Firebase Cloud Messaging — service account credentials.
    // Either the three discrete values, or FCM_SERVICE_ACCOUNT_JSON with the
    // whole downloaded JSON (it is parsed and overrides the discrete values).
    FCM_PROJECT_ID: z.string().default(''),
    FCM_CLIENT_EMAIL: z.string().default(''),
    FCM_PRIVATE_KEY: z.string().default(''),
    FCM_SERVICE_ACCOUNT_JSON: z.string().default(''),
    // Apple Push Notification service — team key (.p8).
    APNS_TEAM_ID: z.string().default(''),
    APNS_KEY_ID: z.string().default(''),
    APNS_PRIVATE_KEY: z.string().default(''),
    APNS_BUNDLE_ID: z.string().default('com.habitoliving.habito'),
    // Sandbox (development builds) vs production (App Store / TestFlight).
    APNS_USE_SANDBOX: bool.default(true),
    // Fail loudly if configured credentials are present but unusable.
    PUSH_STRICT: bool.default(false),
  })
  .superRefine((v, ctx) => {
    const addIssue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (v.NODE_ENV !== 'production') return;

    if (v.EXPOSE_DEV_OTP) {
      addIssue('EXPOSE_DEV_OTP', 'EXPOSE_DEV_OTP must be false in production');
    }
    if (v.PAYMENT_WEBHOOK_SECRET === 'dev-payment-secret') {
      addIssue('PAYMENT_WEBHOOK_SECRET', 'PAYMENT_WEBHOOK_SECRET must be set in production');
    }
    if (v.SUPER_ADMIN_PASSWORD === 'ChangeMe@123') {
      addIssue('SUPER_ADMIN_PASSWORD', 'SUPER_ADMIN_PASSWORD must be changed in production');
    }
    if (v.SUPER_ADMIN_EMAIL === 'superadmin@example.com') {
      addIssue('SUPER_ADMIN_EMAIL', 'SUPER_ADMIN_EMAIL must be set in production');
    }
    if (v.CORS_ORIGINS === '*') {
      addIssue('CORS_ORIGINS', 'CORS_ORIGINS must list allowed origins in production');
    }
    if (v.MONGODB_URI.includes('127.0.0.1') || v.MONGODB_URI.includes('localhost')) {
      addIssue('MONGODB_URI', 'MONGODB_URI must not point to localhost in production');
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  process.stderr.write(`Invalid environment configuration:\n${JSON.stringify(parsed.error.issues, null, 2)}\n`);
  process.exit(1);
}

const fcmFromServiceAccount = (() => {
  const raw = parsed.data.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw.trim()) return null;
  try {
    const json = JSON.parse(raw);
    if (json.project_id && json.client_email && json.private_key) {
      return {
        projectId: String(json.project_id),
        clientEmail: String(json.client_email),
        privateKey: String(json.private_key),
      };
    }
    return null;
  } catch {
    return null;
  }
})();

const fcm = {
  projectId: fcmFromServiceAccount?.projectId ?? parsed.data.FCM_PROJECT_ID,
  clientEmail: fcmFromServiceAccount?.clientEmail ?? parsed.data.FCM_CLIENT_EMAIL,
  privateKey: (fcmFromServiceAccount?.privateKey ?? parsed.data.FCM_PRIVATE_KEY).replace(/\\n/g, '\n'),
};

const apns = {
  teamId: parsed.data.APNS_TEAM_ID,
  keyId: parsed.data.APNS_KEY_ID,
  privateKey: parsed.data.APNS_PRIVATE_KEY.replace(/\\n/g, '\n'),
  bundleId: parsed.data.APNS_BUNDLE_ID,
  useSandbox: parsed.data.APNS_USE_SANDBOX,
};

export const pushConfig = {
  fcm,
  apns,
  fcmEnabled: Boolean(fcm.projectId && fcm.clientEmail && fcm.privateKey),
  apnsEnabled: Boolean(apns.teamId && apns.keyId && apns.privateKey),
  // iOS can go either through APNs directly (preferred when APNS_* is set) or
  // through FCM (APNs key uploaded to Firebase). See docs/PUSH_NOTIFICATIONS.md.
  iosVia: (apns.teamId && apns.keyId && apns.privateKey ? 'apns' : 'fcm') as 'apns' | 'fcm',
  strict: parsed.data.PUSH_STRICT,
};

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  corsOrigins: parsed.data.CORS_ORIGINS === '*' ? '*' : parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()),
};
