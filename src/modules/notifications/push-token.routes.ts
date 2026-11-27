import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok } from '../../common/responses/respond';
import { PushPlatforms, PushToken } from './push-token.model';
import { pushHealth } from './push.service';

const registerBody = z.object({
  token: z.string().trim().min(16).max(4096),
  platform: z.enum(PushPlatforms),
  deviceId: z.string().trim().max(128).optional(),
  deviceName: z.string().trim().max(128).optional(),
  appVersion: z.string().trim().max(32).optional(),
});

const removeBody = z.object({
  token: z.string().trim().min(16).max(4096),
});

export const pushTokenRouter = new ModuleRouter('/api/v1/user/push-tokens', {
  tag: 'Notifications',
  tagDescription:
    'Device push tokens for FCM (Android) and APNs (iOS). Register a token after sign-in; remove it on sign-out. ' +
    'Tokens fan out automatically when the backend creates a notification (see docs/PUSH_NOTIFICATIONS.md).',
  roles: [UserType.SOCIETY_ADMIN, UserType.GUARD, UserType.RESIDENT, UserType.SUPER_ADMIN],
});

pushTokenRouter
  .add({
    method: 'post',
    path: '/',
    summary: 'Register or refresh a device push token',
    description:
      'Upserts by token: the same device re-registering updates lastSeenAt; a token that moved to a new account is re-pointed at the caller. Idempotent.',
    body: registerBody,
    response: z.object({ registered: z.boolean(), purged: z.number().int(), upserted: z.number().int().optional() }),
    status: 201,
    handler: async (req: Request, res: Response) => {
      const body = req.valid.body;
      const result = await PushToken.updateOne(
        { token: body.token },
        {
          $set: {
            userId: req.auth.userId,
            platform: body.platform,
            deviceId: body.deviceId,
            deviceName: body.deviceName,
            appVersion: body.appVersion,
            lastSeenAt: new Date(),
          },
        },
        { upsert: true },
      );
      created(res, { registered: true, purged: 0, upserted: result.upsertedCount ?? 0 }, 'Push token registered');
    },
  })
  .add({
    method: 'post',
    path: '/remove',
    summary: 'Remove a device push token',
    description: 'Called on sign-out and when the user disables push in settings. Scoped to the caller: you can only remove your own tokens.',
    body: removeBody,
    response: z.object({ removed: z.boolean() }),
    status: 200,
    handler: async (req: Request, res: Response) => {
      const result = await PushToken.deleteOne({ token: req.valid.body.token, userId: req.auth.userId });
      ok(res, { removed: result.deletedCount > 0 }, 'Push token removed');
    },
  })
  .add({
    method: 'get',
    path: '/health',
    summary: 'Push configuration health (no secrets)',
    description: 'Reports which transports are configured. Intended for ops verification after deploy.',
    response: z.object({ fcmEnabled: z.boolean(), apnsEnabled: z.boolean(), iosVia: z.enum(['apns', 'fcm']), strict: z.boolean(), fcmProjectId: z.string().nullable() }),
    status: 200,
    handler: async (_req: Request, res: Response) => {
      ok(res, pushHealth());
    },
  });
