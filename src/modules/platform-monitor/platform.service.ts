import { applyListFilters, paginate } from '../../common/utils/pagination';
import { oid } from '../../common/utils/objectId';
import { LoginHistory } from '../auth/auth.model';
import { ErrorLog } from '../super-admin/super-admin.model';

/**
 * Society-scoped platform monitoring. Every query is pinned to the authenticated admin's
 * societyId on the server. Only authentication data is exposed (login history, 401/403/429).
 * Server errors (5xx), stack traces and infrastructure health stay in the Super Admin portal.
 */
const populateUser = { path: 'userId', select: 'name userType' };
const AUTH_STATUSES = [401, 403, 429];

const maskIdentifier = (v: string) => {
  if (v.includes('@')) {
    const [name, domain] = v.split('@');
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return v.length <= 5 ? '***' : `${v.slice(0, 3)}${'*'.repeat(Math.max(3, v.length - 5))}${v.slice(-2)}`;
};
const shapeUser = (u: any) => (u && typeof u === 'object' && u.name ? { id: String(u._id ?? u.id), name: u.name, userType: u.userType } : undefined);

export const platformMonitor = {
  async summary(societyId: string, days: number) {
    const since = new Date(Date.now() - days * 86400000);
    const sid = oid(societyId);
    const [success, failed, users, errors, byDay, bursts] = await Promise.all([
      LoginHistory.countDocuments({ societyId, success: true, createdAt: { $gte: since } }),
      LoginHistory.countDocuments({ societyId, success: false, createdAt: { $gte: since } }),
      LoginHistory.distinct('userId', { societyId, success: true, createdAt: { $gte: since } }),
      ErrorLog.aggregate([{ $match: { societyId: sid, status: { $in: AUTH_STATUSES }, createdAt: { $gte: since } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      LoginHistory.aggregate([{ $match: { societyId: sid, createdAt: { $gte: since } } }, { $group: { _id: { d: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, s: '$success' }, n: { $sum: 1 } } }]),
      LoginHistory.aggregate([{ $match: { societyId: sid, success: false, createdAt: { $gte: new Date(Date.now() - 3600000) }, ip: { $ne: null } } }, { $group: { _id: '$ip', n: { $sum: 1 }, last: { $max: '$createdAt' } } }, { $match: { n: { $gte: 5 } } }, { $sort: { n: -1 } }, { $limit: 20 }]),
    ]);
    const count = (s: number) => errors.find((e: any) => e._id === s)?.n ?? 0;
    const perDay: Record<string, { successful: number; failed: number }> = {};
    byDay.forEach((r: any) => {
      const d = (perDay[r._id.d] ??= { successful: 0, failed: 0 });
      if (r._id.s) d.successful += r.n;
      else d.failed += r.n;
    });
    return {
      days,
      logins: { successful: success, failed, distinctUsers: users.length },
      authErrors: { unauthorized: count(401), forbidden: count(403), rateLimited: count(429) },
      byDay: Object.entries(perDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v })),
      suspicious: bursts.map((b: any) => ({ type: 'FAILED_LOGIN_BURST', key: String(b._id), count: b.n, lastSeenAt: b.last })),
    };
  },
  async loginActivity(societyId: string, q: any) {
    const f: Record<string, unknown> = { societyId };
    if (q.success !== undefined) f.success = q.success;
    ['method', 'userId'].forEach((k) => q[k] && (f[k] = q[k]));
    const r = await paginate(LoginHistory, applyListFilters(f, q), q, { sortable: ['createdAt'], populate: populateUser });
    return { ...r, items: r.items.map((h: any) => ({ id: String(h._id), user: shapeUser(h.userId), identifier: maskIdentifier(h.identifier ?? ''), success: h.success, reason: h.reason, method: h.method, ip: h.ip, userAgent: h.userAgent, createdAt: h.createdAt })) };
  },
  async authEvents(societyId: string, q: any) {
    const f: Record<string, unknown> = { societyId, status: q.status ?? { $in: AUTH_STATUSES } };
    const r = await paginate(ErrorLog, applyListFilters(f, q, ['path', 'code']), q, { sortable: ['createdAt', 'status'], select: '-stack -requestId', populate: populateUser });
    return { ...r, items: r.items.map((e: any) => ({ id: String(e._id), status: e.status, code: e.code, message: e.message, method: e.method, path: e.path, user: shapeUser(e.userId), ip: e.ip, createdAt: e.createdAt })) };
  },
};
