import { z } from 'zod';
import { entity } from '../../common/responses/schemas';
import { dateTime, listQuery, objectId } from '../../common/validators/common';
import { CALL_STATUSES } from './call.model';

export const startCallBody = z.object({ calleeId: objectId });
export const contactsQuery = z.object({ role: z.enum(['RESIDENT', 'GUARD', 'SOCIETY_ADMIN']).optional(), search: z.string().trim().min(1).max(60).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
export const historyQuery = listQuery.extend({ status: z.enum(CALL_STATUSES).optional() });
export const signalBody = z.object({ callId: objectId, type: z.enum(['offer', 'answer', 'candidate']), data: z.any() });

export const contactItem = z.object({ userId: objectId, name: z.string(), role: z.enum(['RESIDENT', 'GUARD', 'SOCIETY_ADMIN']), label: z.string().optional() });
export const callItem = entity({
  callerId: objectId,
  calleeId: objectId,
  callerRole: z.string(),
  calleeRole: z.string(),
  callerName: z.string().optional(),
  callerLabel: z.string().optional(),
  calleeName: z.string().optional(),
  calleeLabel: z.string().optional(),
  status: z.enum(CALL_STATUSES),
  answeredAt: dateTime.optional(),
  endedAt: dateTime.optional(),
  endReason: z.string().optional(),
});
export const iceItem = z.object({ iceServers: z.array(z.object({ urls: z.array(z.string()), username: z.string().optional(), credential: z.string().optional() })), ringSeconds: z.number().int(), expiresInSeconds: z.number().int() });
