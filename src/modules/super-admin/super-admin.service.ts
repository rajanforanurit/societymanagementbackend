import mongoose from 'mongoose';
import { ApiError } from '../../common/utils/apiError';
import { nextSeq } from '../../common/services/counter';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { addDays } from '../../common/utils/dates';
import { schedulerState } from '../../jobs/state';
import { realtime } from '../../realtime/socket';
import { env } from '../../config/env';
import { AdminProfile } from '../admin/admin.model';
import { AuditLog } from '../audit/audit.model';
import { LoginHistory, RefreshToken, User } from '../auth/auth.model';
import { Guard } from '../guard/guard.model';
import { Resident } from '../resident/resident.model';
import { Society } from '../society/society.model';
import { notifyUsers } from '../notifications/notify.service';
import { ErrorLog, ImpersonationSession, Organization, PlatformAnnouncement, SubscriptionPlan, SupportTicket } from './super-admin.model';

const day = () => new Date(Date.now() - 86400000);
const skip = { skipTenantCheck: true };

export const superAdminService = {
  async dashboard() {
    const [total, active, inactive, pending, builders, admins, residents, guards, reqs, logins, failed, newRes, serverErr, authFail, tickets] = await Promise.all([
      Society.countDocuments({}),
      Society.countDocuments({ status: 'ACTIVE' }),
      Society.countDocuments({ status: { $in: ['INACTIVE', 'SUSPENDED'] } }),
      Society.countDocuments({ status: 'PENDING' }),
      Organization.countDocuments({}),
      User.countDocuments({ userType: 'SOCIETY_ADMIN' }),
      Resident.countDocuments({ status: 'APPROVED' }).setOptions(skip),
      Guard.countDocuments({ status: 'ACTIVE' }).setOptions(skip),
      AuditLog.countDocuments({ createdAt: { $gte: day() } }),
      LoginHistory.countDocuments({ success: true, createdAt: { $gte: day() } }),
      LoginHistory.countDocuments({ success: false, createdAt: { $gte: day() } }),
      Resident.countDocuments({ createdAt: { $gte: addDays(new Date(), -7) } }).setOptions(skip),
      ErrorLog.countDocuments({ status: { $gte: 500 }, createdAt: { $gte: day() } }),
      ErrorLog.countDocuments({ status: { $in: [401, 403] }, createdAt: { $gte: day() } }),
      SupportTicket.countDocuments({ status: { $in: ['OPEN', 'IN_PROGRESS'] } }),
    ]);
    return { societies: { total, active, inactive, pending }, builders, admins, residents, guards, activity: { requestsLast24h: reqs, loginsLast24h: logins, failedLoginsLast24h: failed, newResidentsLast7d: newRes }, errors: { serverErrorsLast24h: serverErr, authFailuresLast24h: authFail }, openSupportTickets: tickets };
  },
  async health() {
    const state = ['disconnected', 'connected', 'connecting', 'disconnecting'][mongoose.connection.readyState] ?? 'unknown';
    let transactions = false;
    try {
      const info: any = await mongoose.connection.db!.admin().command({ hello: 1 });
      transactions = Boolean(info.setName) || info.msg === 'isdbgrid';
    } catch {
      transactions = false;
    }
    return { status: state === 'connected' ? ('ok' as const) : ('degraded' as const), uptimeSeconds: Math.round(process.uptime()), database: { state, transactions }, memoryMb: Math.round(process.memoryUsage().rss / 1048576), realtimeConnections: realtime.connectedCount(), scheduler: { lastRunAt: schedulerState.lastRunAt?.toISOString() ?? null, lastError: schedulerState.lastError }, version: process.env.npm_package_version ?? '1.0.0' };
  },
  async errors(q: any) {
    const f: Record<string, unknown> = {};
    ['status', 'societyId'].forEach((k) => q[k] && (f[k] = q[k]));
    if (q.path) f.path = new RegExp(`^${q.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
    const r = await paginate(ErrorLog, applyListFilters(f, q, ['message', 'code', 'path']), q, { sortable: ['createdAt', 'status'], select: '-stack' });
    return r;
  },
  async featureUsage(q: { days: number; societyId?: string }) {
    const match: Record<string, any> = { createdAt: { $gte: addDays(new Date(), -q.days) }, action: { $regex: '^(POST|PUT|PATCH|DELETE) /api/v1/' } };
    if (q.societyId) match.societyId = new mongoose.Types.ObjectId(q.societyId);
    const rows = await AuditLog.aggregate([
      { $match: match },
      { $addFields: { parts: { $split: [{ $arrayElemAt: [{ $split: ['$action', ' '] }, 1] }, '/'] } } },
      { $addFields: { module: { $arrayElemAt: ['$parts', 5] } } },
      { $group: { _id: '$module', actions: { $sum: 1 }, societies: { $addToSet: '$societyId' } } },
      { $project: { _id: 0, module: { $ifNull: ['$_id', 'unknown'] }, actions: 1, societies: { $size: '$societies' } } },
      { $sort: { actions: -1 } },
    ]);
    return rows;
  },
  async loginHistory(q: any) {
    const f: Record<string, unknown> = {};
    ['success', 'userId', 'ip'].forEach((k) => q[k] !== undefined && (f[k] = q[k]));
    return paginate(LoginHistory, applyListFilters(f, q, ['identifier']), q, { sortable: ['createdAt'] });
  },
  async suspicious() {
    const since = new Date(Date.now() - 3600000);
    const bursts = await LoginHistory.aggregate([{ $match: { success: false, createdAt: { $gte: since } } }, { $group: { _id: '$ip', n: { $sum: 1 }, last: { $max: '$createdAt' } } }, { $match: { n: { $gte: 10 }, _id: { $ne: null } } }, { $sort: { n: -1 } }, { $limit: 50 }]);
    const multi = await LoginHistory.aggregate([{ $match: { createdAt: { $gte: since }, ip: { $ne: null } } }, { $group: { _id: '$ip', ids: { $addToSet: '$identifier' }, last: { $max: '$createdAt' } } }, { $project: { n: { $size: '$ids' }, last: 1 } }, { $match: { n: { $gte: 5 } } }, { $limit: 50 }]);
    return [...bursts.map((b: any) => ({ type: 'FAILED_LOGIN_BURST', key: String(b._id), count: b.n, lastSeenAt: b.last })), ...multi.map((m: any) => ({ type: 'MULTI_ACCOUNT_IP', key: String(m._id), count: m.n, lastSeenAt: m.last }))];
  },
  async setUserAccess(actorId: string, id: string, block: boolean, reason?: string) {
    const u: any = await User.findById(id);
    if (!u) throw ApiError.notFound('User not found');
    if (u.userType === 'SUPER_ADMIN') throw ApiError.forbidden('Super admin accounts cannot be restricted here', 'FORBIDDEN');
    await User.updateOne({ _id: id }, block ? { $set: { isActive: false, blockedReason: reason }, $inc: { tokenVersion: 1 } } : { $set: { isActive: true }, $unset: { blockedReason: 1 } });
    if (block) await RefreshToken.updateMany({ userId: id, revokedAt: null }, { $set: { revokedAt: new Date() } });
    await AuditLog.create([{ actorId, actorRole: 'SUPER_ADMIN', action: block ? 'USER_BLOCKED' : 'USER_UNBLOCKED', entityType: 'User', entityId: id, metadata: { reason } }]);
    return User.findById(id);
  },
  async users(q: any) {
    const f: Record<string, unknown> = {};
    ['userType', 'isActive'].forEach((k) => q[k] !== undefined && (f[k] = q[k]));
    const r = await paginate(User, applyListFilters(f, q, ['name', 'mobile', 'email']), q, { sortable: ['createdAt', 'name', 'lastLoginAt'] });
    return { ...r, items: r.items.map((u: any) => ({ id: String(u._id), name: u.name, mobile: u.mobile, userType: u.userType, isActive: u.isActive })) };
  },
  async impersonations(q: any) {
    const f: Record<string, unknown> = {};
    if (q.societyId) f.societyId = q.societyId;
    if (q.active === true) Object.assign(f, { endedAt: null, expiresAt: { $gt: new Date() } });
    return paginate(ImpersonationSession, f, q, { sortable: ['startedAt'], defaultSort: '-startedAt' });
  },
  async createTicket(actor: { userId: string; role: string; societyId?: string }, body: any) {
    const n = await nextSeq('support-ticket');
    return SupportTicket.create({ ...body, ticketNumber: `TKT-${String(n).padStart(6, '0')}`, societyId: body.societyId ?? actor.societyId, raisedBy: actor.userId, createdBy: actor.userId, comments: [] });
  },
  async listTickets(q: any, scope: Record<string, unknown> = {}) {
    const f: Record<string, unknown> = { ...scope };
    ['status', 'priority', 'category', 'societyId'].forEach((k) => q[k] && (f[k] = q[k]));
    return paginate(SupportTicket, applyListFilters(f, q, ['subject', 'ticketNumber']), q, { sortable: ['createdAt', 'priority', 'status'] });
  },
  async getTicket(id: string, scope: Record<string, unknown> = {}) {
    const t = await SupportTicket.findOne({ _id: id, ...scope });
    if (!t) throw ApiError.notFound('Ticket not found');
    return t;
  },
  async updateTicket(id: string, body: any, actorId: string) {
    const set: Record<string, unknown> = { ...body, updatedBy: actorId };
    if (body.status === 'RESOLVED') set.resolvedAt = new Date();
    const t = await SupportTicket.findByIdAndUpdate(id, { $set: set }, { new: true });
    if (!t) throw ApiError.notFound('Ticket not found');
    if (body.status) await notifyUsers({ societyId: t.societyId ? String(t.societyId) : undefined, userIds: [t.raisedBy], type: 'SYSTEM', title: `${t.ticketNumber} is ${body.status.toLowerCase().replace('_', ' ')}`, body: t.subject, data: { ticketId: id } });
    return t;
  },
  async commentTicket(id: string, actor: { userId: string; role: string }, message: string, scope: Record<string, unknown> = {}) {
    const t = await SupportTicket.findOneAndUpdate({ _id: id, ...scope }, { $push: { comments: { authorId: actor.userId, authorRole: actor.role, message } } }, { new: true });
    if (!t) throw ApiError.notFound('Ticket not found');
    return t;
  },
  async activeAnnouncements(role: string, societyId?: string) {
    const aud = role === 'SOCIETY_ADMIN' ? ['ALL', 'ADMINS'] : role === 'GUARD' ? ['ALL', 'GUARDS'] : ['ALL', 'RESIDENTS'];
    const now = new Date();
    return PlatformAnnouncement.find({ isActive: true, audience: { $in: aud }, startsAt: { $lte: now }, $and: [{ $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }, { $or: [{ societyIds: { $size: 0 } }, ...(societyId ? [{ societyIds: societyId }] : [])] }] }).sort({ createdAt: -1 }).limit(20);
  },
  env: () => env.NODE_ENV,
  SubscriptionPlan,
  Organization,
};
