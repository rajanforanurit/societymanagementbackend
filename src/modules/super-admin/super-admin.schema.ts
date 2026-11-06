import { z } from 'zod';
import { Audience, BillingCycle, FEATURE_KEYS, Priority, Severity, TicketCategory, TicketStatus, vals } from '../../common/constants/enums';
import { globalEntity } from '../../common/responses/schemas';
import { dateTime, email, listQuery, mobile, objectId } from '../../common/validators/common';

export const orgBody = z.object({ name: z.string().trim().min(2).max(150), contactEmail: email.optional(), contactPhone: mobile.optional(), address: z.string().max(300).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE') });
export const orgItem = globalEntity({ name: z.string(), contactEmail: z.string().optional(), contactPhone: z.string().optional(), address: z.string().optional(), status: z.string() });
export const orgQuery = listQuery.extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() });

const flags = z.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean().default(true)])) as any);
export const planBody = z.object({ name: z.string().trim().min(2).max(100), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{2,20}$/), price: z.number().min(0).default(0), billingCycle: z.enum(vals(BillingCycle)).default('MONTHLY'), features: flags.default(Object.fromEntries(FEATURE_KEYS.map((k) => [k, true])) as any), limits: z.object({ maxFlats: z.number().int().min(1).optional(), maxGuards: z.number().int().min(1).optional(), maxAdmins: z.number().int().min(1).optional() }).default({}), isActive: z.boolean().default(true) });
export const planItem = globalEntity({ name: z.string(), code: z.string(), price: z.number(), billingCycle: z.enum(vals(BillingCycle)), features: z.record(z.string(), z.boolean()), limits: z.record(z.string(), z.number()).optional(), isActive: z.boolean() });
export const planQuery = listQuery.extend({ isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });

export const announcementBody = z.object({ title: z.string().trim().min(3).max(200), body: z.string().trim().min(3).max(5000), severity: z.enum(vals(Severity)).default('INFO'), audience: z.enum(vals(Audience)).default('ALL'), societyIds: z.array(objectId).max(500).default([]), startsAt: dateTime.optional(), endsAt: dateTime.optional(), isActive: z.boolean().default(true) });
export const announcementItem = globalEntity({ title: z.string(), body: z.string(), severity: z.enum(vals(Severity)), audience: z.enum(vals(Audience)), societyIds: z.array(objectId), startsAt: dateTime.optional(), endsAt: dateTime.optional(), isActive: z.boolean() });
export const announcementQuery = listQuery.extend({ audience: z.enum(vals(Audience)).optional(), isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });

export const configBody = z.object({ value: z.any(), description: z.string().max(300).optional() });
export const configItem = globalEntity({ key: z.string(), value: z.any(), description: z.string().optional() });
export const configKey = z.object({ key: z.string().regex(/^[a-zA-Z0-9_.-]{2,80}$/) });

export const templateBody = z.object({ key: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{3,60}$/), channel: z.enum(['PUSH', 'SMS', 'EMAIL', 'IN_APP']).default('IN_APP'), title: z.string().trim().min(2).max(200), body: z.string().trim().min(2).max(2000), locale: z.string().max(10).default('en'), isActive: z.boolean().default(true) });
export const templateItem = globalEntity({ key: z.string(), channel: z.string(), title: z.string(), body: z.string(), locale: z.string(), isActive: z.boolean() });
export const templateQuery = listQuery.extend({ channel: z.enum(['PUSH', 'SMS', 'EMAIL', 'IN_APP']).optional(), isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });

export const ticketBody = z.object({ subject: z.string().trim().min(5).max(200), description: z.string().trim().min(10).max(5000), category: z.enum(vals(TicketCategory)).default('OTHER'), priority: z.enum(vals(Priority)).default('MEDIUM'), attachments: z.array(objectId).max(5).default([]) });
export const superTicketBody = ticketBody.extend({ societyId: objectId.optional() });
export const ticketItem = globalEntity({ ticketNumber: z.string(), societyId: objectId.optional(), raisedBy: objectId, subject: z.string(), description: z.string(), category: z.enum(vals(TicketCategory)), priority: z.enum(vals(Priority)), status: z.enum(vals(TicketStatus)), assignedTo: objectId.optional(), comments: z.array(z.object({ authorId: objectId, authorRole: z.string().optional(), message: z.string(), createdAt: dateTime })) });
export const ticketQuery = listQuery.extend({ status: z.enum(vals(TicketStatus)).optional(), priority: z.enum(vals(Priority)).optional(), category: z.enum(vals(TicketCategory)).optional(), societyId: objectId.optional() });
export const ticketUpdate = z.object({ status: z.enum(vals(TicketStatus)).optional(), priority: z.enum(vals(Priority)).optional(), assignedTo: objectId.optional() });
export const ticketComment = z.object({ message: z.string().trim().min(1).max(3000) });

export const dashboardItem = z.object({
  societies: z.object({ total: z.number().int(), active: z.number().int(), inactive: z.number().int(), pending: z.number().int() }),
  builders: z.number().int(),
  admins: z.number().int(),
  residents: z.number().int(),
  guards: z.number().int(),
  activity: z.object({ requestsLast24h: z.number().int(), loginsLast24h: z.number().int(), failedLoginsLast24h: z.number().int(), newResidentsLast7d: z.number().int() }),
  errors: z.object({ serverErrorsLast24h: z.number().int(), authFailuresLast24h: z.number().int() }),
  openSupportTickets: z.number().int(),
});
export const healthItem = z.object({ status: z.enum(['ok', 'degraded']), uptimeSeconds: z.number(), database: z.object({ state: z.string(), transactions: z.boolean() }), memoryMb: z.number(), realtimeConnections: z.number().int(), scheduler: z.object({ lastRunAt: z.string().nullable(), lastError: z.string().nullable() }), version: z.string() });
export const errorLogItem = globalEntity({ requestId: z.string().optional(), method: z.string().optional(), path: z.string().optional(), status: z.number().optional(), code: z.string().optional(), message: z.string().optional(), userId: objectId.optional(), societyId: objectId.optional(), ip: z.string().optional() });
export const errorLogQuery = listQuery.extend({ status: z.coerce.number().int().min(400).max(599).optional(), societyId: objectId.optional(), path: z.string().max(200).optional() });
export const featureUsage = z.array(z.object({ module: z.string(), actions: z.number().int(), societies: z.number().int() }));
export const usageQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(7), societyId: objectId.optional() });
export const loginHistoryItem = globalEntity({ userId: objectId.optional(), identifier: z.string(), success: z.boolean(), reason: z.string().optional(), method: z.string().optional(), societyId: objectId.optional(), ip: z.string().optional(), userAgent: z.string().optional() });
export const loginHistoryQuery = listQuery.extend({ success: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), userId: objectId.optional(), ip: z.string().max(60).optional() });
export const suspiciousItem = z.object({ type: z.enum(['FAILED_LOGIN_BURST', 'MULTI_ACCOUNT_IP']), key: z.string(), count: z.number().int(), lastSeenAt: dateTime });
export const blockBody = z.object({ reason: z.string().trim().min(5).max(300) });
export const impersonationItem = globalEntity({ superAdminId: objectId, societyId: objectId, reason: z.string(), startedAt: dateTime, expiresAt: dateTime, endedAt: dateTime.optional() });
export const impersonationQuery = listQuery.extend({ societyId: objectId.optional(), active: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });
export const userLite = z.object({ id: objectId, name: z.string(), mobile: z.string(), userType: z.string(), isActive: z.boolean() });
export const userQuery = listQuery.extend({ userType: z.string().optional(), isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });
