import { ComplaintStatus, NotificationType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { addHours, addDays } from '../../common/utils/dates';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { oid } from '../../common/utils/objectId';
import { nextSeq } from '../../common/services/counter';
import { notifyAdmins, notifyFlat, notifyUsers } from '../notifications/notify.service';
import { Flat, Society } from '../society/society.model';
import { User } from '../auth/auth.model';
import { Staff, Vendor } from '../staff/staff.model';
import { Complaint, ComplaintAssignment } from './complaint.model';

const FORWARD: Record<string, string[]> = {
  OPEN: ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED'],
  ASSIGNED: ['IN_PROGRESS', 'RESOLVED', 'ESCALATED', 'OPEN'],
  IN_PROGRESS: ['RESOLVED', 'ESCALATED', 'ASSIGNED'],
  ESCALATED: ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED'],
  REOPENED: ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED'],
  RESOLVED: ['CLOSED', 'REOPENED'],
  CLOSED: [],
};

const hideInternal = (c: any) => {
  const j = c.toJSON();
  j.comments = (j.comments ?? []).filter((x: any) => !x.isInternal);
  return j;
};

const slaFor = async (societyId: string, priority: string) => {
  const s: any = await Society.findById(societyId).select('settings.complaint');
  return s?.settings?.complaint?.slaHours?.[priority] ?? 48;
};

const load = async (societyId: string, id: string, extra: Record<string, unknown> = {}) => {
  const c: any = await Complaint.findOne({ _id: id, societyId, ...extra });
  if (!c) throw ApiError.notFound('Complaint not found');
  return c;
};

export const complaintService = {
  async raise(societyId: string, userId: string, residents: { flatId: string; permissions: Record<string, boolean> }[], body: any) {
    const res = body.flatId ? residents.find((r) => r.flatId === body.flatId) : residents[0];
    if (!res) throw ApiError.forbidden('You do not belong to this flat', 'FLAT_FORBIDDEN');
    if (res.permissions.canRaiseComplaints === false) throw ApiError.forbidden('You are not permitted to raise complaints', 'RESIDENT_PERMISSION_DENIED');
    const flat: any = await Flat.findOne({ _id: res.flatId, societyId });
    const slaHours = await slaFor(societyId, body.priority);
    const seq = await nextSeq(`complaint:${societyId}`);
    const c: any = await Complaint.create({ ...body, societyId, flatId: res.flatId, flatLabel: flat?.label, raisedBy: userId, createdBy: userId, ticketNumber: `CMP-${String(seq).padStart(5, '0')}`, slaHours, dueAt: addHours(new Date(), slaHours), history: [{ status: 'OPEN', by: userId, note: 'Complaint raised' }] });
    await notifyAdmins(societyId, 'complaint:manage', { type: NotificationType.COMPLAINT, title: `New complaint ${c.ticketNumber}`, body: `${body.category}: ${body.title}`, data: { complaintId: String(c._id) }, event: 'complaint:new' });
    return c;
  },
  async listMine(societyId: string, userId: string, flatIds: string[], q: any) {
    const f: Record<string, unknown> = { societyId, $or: [{ raisedBy: userId }, { flatId: { $in: flatIds.map(oid) } }] };
    ['status', 'category', 'priority'].forEach((k) => q[k] && (f[k] = q[k]));
    const r = await paginate(Complaint, applyListFilters(f, q, ['title', 'ticketNumber']), q, { sortable: ['createdAt', 'priority', 'status'], select: '-comments' });
    return r;
  },
  async getMine(societyId: string, userId: string, flatIds: string[], id: string) {
    const c = await load(societyId, id, { $or: [{ raisedBy: userId }, { flatId: { $in: flatIds.map(oid) } }] });
    return hideInternal(c);
  },
  async comment(societyId: string, a: { userId: string; role: string; flatIds?: string[] }, id: string, body: any, admin: boolean) {
    const c = await load(societyId, id, admin ? {} : { $or: [{ raisedBy: a.userId }, { flatId: { $in: (a.flatIds ?? []).map(oid) } }] });
    if (c.comments.length >= 200) throw ApiError.conflict('Comment limit reached for this complaint', 'COMMENT_LIMIT');
    const internal = admin && body.isInternal === true;
    await Complaint.updateOne({ _id: id, societyId }, { $push: { comments: { authorId: a.userId, authorRole: a.role, message: body.message, attachments: body.attachments, isInternal: internal } } });
    if (!internal) {
      if (admin) await notifyUsers({ societyId, userIds: [c.raisedBy], type: NotificationType.COMPLAINT, title: `Update on ${c.ticketNumber}`, body: body.message.slice(0, 120), data: { complaintId: id }, event: 'complaint:updated' });
      else await notifyAdmins(societyId, 'complaint:manage', { type: NotificationType.COMPLAINT, title: `Resident replied on ${c.ticketNumber}`, body: body.message.slice(0, 120), data: { complaintId: id } });
    }
    return admin ? load(societyId, id) : hideInternal(await load(societyId, id));
  },
  async reopen(societyId: string, userId: string, flatIds: string[], id: string, reason: string) {
    const c = await load(societyId, id, { $or: [{ raisedBy: userId }, { flatId: { $in: flatIds.map(oid) } }] });
    if (![ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED].includes(c.status)) throw ApiError.conflict('Only resolved or closed complaints can be reopened', 'INVALID_STATE');
    if (c.resolvedAt && Date.now() - c.resolvedAt.getTime() > 7 * 86400000) throw ApiError.conflict('Complaints can only be reopened within 7 days of resolution', 'REOPEN_WINDOW_PASSED');
    const hours = c.slaHours ?? 48;
    await Complaint.updateOne({ _id: id, societyId }, { $set: { status: 'REOPENED', dueAt: addHours(new Date(), hours), resolvedAt: undefined, closedAt: undefined }, $inc: { reopenedCount: 1 }, $push: { history: { status: 'REOPENED', by: userId, note: reason } } });
    await notifyAdmins(societyId, 'complaint:manage', { type: NotificationType.COMPLAINT, title: `Complaint ${c.ticketNumber} reopened`, body: reason, data: { complaintId: id }, event: 'complaint:reopened' });
    return hideInternal(await load(societyId, id));
  },
  async rate(societyId: string, userId: string, id: string, body: { score: number; feedback?: string }) {
    const r = await Complaint.findOneAndUpdate({ _id: id, societyId, raisedBy: userId, status: { $in: ['RESOLVED', 'CLOSED'] }, 'rating.score': null }, { $set: { rating: { ...body, at: new Date() } } }, { new: true });
    if (!r) throw ApiError.conflict('Only your resolved complaints that are not yet rated can be rated', 'INVALID_STATE');
    return hideInternal(r);
  },

  async adminList(societyId: string, q: any) {
    const f: Record<string, any> = { societyId };
    ['status', 'category', 'priority', 'flatId'].forEach((k) => q[k] && (f[k] = q[k]));
    if (q.assigneeType) f['assignee.type'] = q.assigneeType;
    if (q.assigneeId) f['assignee.refId'] = q.assigneeId;
    if (q.overdue === true) Object.assign(f, { dueAt: { $lt: new Date() }, status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED', 'ESCALATED'] } });
    return paginate(Complaint, applyListFilters(f, q, ['title', 'ticketNumber', 'flatLabel']), q, { sortable: ['createdAt', 'dueAt', 'priority', 'status'], select: '-comments' });
  },
  adminGet: (societyId: string, id: string) => load(societyId, id),
  async adminUpdate(societyId: string, userId: string, id: string, body: any) {
    const c = await load(societyId, id);
    const set: Record<string, unknown> = { updatedBy: userId };
    const push: Record<string, unknown> = {};
    if (body.priority) set.priority = body.priority;
    if (body.slaHours) Object.assign(set, { slaHours: body.slaHours, dueAt: addHours(c.createdAt, body.slaHours) });
    if (body.status && body.status !== c.status) {
      if (!FORWARD[c.status]?.includes(body.status)) throw ApiError.conflict(`Cannot move from ${c.status} to ${body.status}`, 'INVALID_TRANSITION', { allowed: FORWARD[c.status] });
      set.status = body.status;
      if (body.status === 'RESOLVED') set.resolvedAt = new Date();
      if (body.status === 'CLOSED') set.closedAt = new Date();
      push.history = { status: body.status, by: userId, note: body.note };
    }
    const r = await Complaint.findOneAndUpdate({ _id: id, societyId, status: c.status }, { $set: set, ...(Object.keys(push).length ? { $push: push } : {}) }, { new: true });
    if (!r) throw ApiError.conflict('Complaint was modified concurrently', 'CONCURRENT_UPDATE');
    if (body.status) await notifyUsers({ societyId, userIds: [c.raisedBy], type: NotificationType.COMPLAINT, title: `${c.ticketNumber} is now ${body.status.replace('_', ' ').toLowerCase()}`, body: body.note ?? c.title, data: { complaintId: id, status: body.status }, event: 'complaint:updated' });
    return r;
  },
  async assign(societyId: string, userId: string, id: string, body: any) {
    const c = await load(societyId, id);
    if (['CLOSED'].includes(c.status)) throw ApiError.conflict('Closed complaints cannot be assigned', 'INVALID_STATE');
    let name: string | undefined;
    if (body.assigneeType === 'STAFF') name = ((await Staff.findOne({ _id: body.assigneeId, societyId, status: 'ACTIVE' })) as any)?.name;
    else if (body.assigneeType === 'VENDOR') name = ((await Vendor.findOne({ _id: body.assigneeId, societyId, status: 'ACTIVE' })) as any)?.name;
    else name = ((await User.findOne({ _id: body.assigneeId, userType: 'SOCIETY_ADMIN' })) as any)?.name;
    if (!name) throw ApiError.notFound('Assignee not found');
    await ComplaintAssignment.updateMany({ societyId, complaintId: id, active: true }, { $set: { active: false } });
    await ComplaintAssignment.create({ societyId, complaintId: id, assigneeType: body.assigneeType, assigneeId: body.assigneeId, assigneeName: name, assignedBy: userId, note: body.note, createdBy: userId });
    const set: Record<string, unknown> = { assignee: { type: body.assigneeType, refId: body.assigneeId, name }, assignedAt: new Date(), updatedBy: userId, status: ['OPEN', 'REOPENED', 'ESCALATED'].includes(c.status) ? 'ASSIGNED' : c.status };
    if (body.slaHours) Object.assign(set, { slaHours: body.slaHours, dueAt: addHours(new Date(), body.slaHours) });
    const r = await Complaint.findOneAndUpdate({ _id: id, societyId }, { $set: set, $push: { history: { status: set.status, by: userId, note: `Assigned to ${name}` } } }, { new: true });
    await notifyUsers({ societyId, userIds: [c.raisedBy], type: NotificationType.COMPLAINT, title: `${c.ticketNumber} assigned`, body: `Assigned to ${name}`, data: { complaintId: id }, event: 'complaint:updated' });
    return r;
  },
  async escalate(societyId: string, userId: string, id: string, reason: string) {
    const c = await load(societyId, id);
    if (['RESOLVED', 'CLOSED'].includes(c.status)) throw ApiError.conflict('Resolved complaints cannot be escalated', 'INVALID_STATE');
    const r = await Complaint.findOneAndUpdate({ _id: id, societyId }, { $set: { status: 'ESCALATED', escalatedAt: new Date() }, $inc: { escalationLevel: 1 }, $push: { history: { status: 'ESCALATED', by: userId, note: reason } } }, { new: true });
    await notifyAdmins(societyId, 'complaint:manage', { type: NotificationType.COMPLAINT, title: `Complaint ${c.ticketNumber} escalated`, body: reason, data: { complaintId: id } });
    return r;
  },
  async history(societyId: string, id: string) {
    await load(societyId, id);
    return ComplaintAssignment.find({ societyId, complaintId: id }).sort({ createdAt: -1 });
  },
  async report(societyId: string, q: { from?: string; to?: string }) {
    const match: Record<string, any> = { societyId: oid(societyId) };
    if (q.from || q.to) match.createdAt = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lte: new Date(`${q.to}T23:59:59.999Z`) } : {}) };
    const [byStatus, byCategory, other] = await Promise.all([
      Complaint.aggregate([{ $match: match }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Complaint.aggregate([{ $match: match }, { $group: { _id: '$category', n: { $sum: 1 } } }]),
      Complaint.aggregate([{ $match: match }, { $group: { _id: null, overdue: { $sum: { $cond: [{ $and: [{ $lt: ['$dueAt', new Date()] }, { $in: ['$status', ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED', 'ESCALATED']] }] }, 1, 0] } }, avgMs: { $avg: { $cond: [{ $ne: ['$resolvedAt', null] }, { $subtract: ['$resolvedAt', '$createdAt'] }, null] } }, avgRating: { $avg: '$rating.score' } } }]),
    ]);
    const toMap = (rows: any[]) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
    const o = other[0] ?? {};
    return { total: byStatus.reduce((s: number, r: any) => s + r.n, 0), byStatus: toMap(byStatus), byCategory: toMap(byCategory), overdue: o.overdue ?? 0, avgResolutionHours: o.avgMs ? Math.round((o.avgMs / 3600000) * 10) / 10 : null, avgRating: o.avgRating ? Math.round(o.avgRating * 10) / 10 : null };
  },
  async escalateOverdue() {
    const due: any[] = await Complaint.find({ status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED'] }, dueAt: { $lt: new Date() }, escalationLevel: 0 }).setOptions({ skipTenantCheck: true }).limit(200);
    for (const c of due) {
      await Complaint.updateOne({ _id: c._id, societyId: c.societyId, escalationLevel: 0 }, { $set: { status: 'ESCALATED', escalatedAt: new Date() }, $inc: { escalationLevel: 1 }, $push: { history: { status: 'ESCALATED', note: 'SLA breached - auto escalated' } } });
      await notifyAdmins(String(c.societyId), 'complaint:manage', { type: NotificationType.COMPLAINT, title: `SLA breached: ${c.ticketNumber}`, body: c.title, data: { complaintId: String(c._id) }, event: 'complaint:escalated' });
      await notifyFlat(String(c.societyId), String(c.flatId), { type: NotificationType.COMPLAINT, title: `${c.ticketNumber} escalated`, body: 'Your complaint has been escalated to management.', data: { complaintId: String(c._id) } }).catch(() => undefined);
    }
  },
  addDays,
};
