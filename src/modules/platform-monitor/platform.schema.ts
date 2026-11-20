import { z } from 'zod';
import { dateTime, listQuery, objectId } from '../../common/validators/common';

export const summaryQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7) });
export const loginActivityQuery = listQuery.extend({
  success: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  method: z.enum(['PASSWORD', 'OTP', 'REFRESH']).optional(),
  userId: objectId.optional(),
});
export const authEventQuery = listQuery.extend({ status: z.coerce.number().int().refine((n) => [401, 403, 429].includes(n), 'Use 401, 403 or 429').optional() });

export const summaryItem = z.object({
  days: z.number().int(),
  logins: z.object({ successful: z.number().int(), failed: z.number().int(), distinctUsers: z.number().int() }),
  authErrors: z.object({ unauthorized: z.number().int(), forbidden: z.number().int(), rateLimited: z.number().int() }),
  byDay: z.array(z.object({ date: z.string(), successful: z.number().int(), failed: z.number().int() })),
  suspicious: z.array(z.object({ type: z.string(), key: z.string(), count: z.number().int(), lastSeenAt: dateTime })),
});
const who = z.object({ id: objectId, name: z.string(), userType: z.string() }).optional();
export const loginActivityItem = z.object({ id: objectId, user: who, identifier: z.string(), success: z.boolean(), reason: z.string().optional(), method: z.string().optional(), ip: z.string().optional(), userAgent: z.string().optional(), createdAt: dateTime });
export const authEventItem = z.object({ id: objectId, status: z.number().int(), code: z.string().optional(), message: z.string().optional(), method: z.string().optional(), path: z.string().optional(), user: who, ip: z.string().optional(), createdAt: dateTime });
