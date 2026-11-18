import { NotificationType } from '../../common/constants/enums';
import { env } from '../../config/env';
import { User } from '../auth/auth.model';
import { ApiError } from '../../common/utils/apiError';
import { createCrudService } from '../../common/services/crud.service';
import { logger } from '../../common/utils/logger';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { notifyAdmins, notifyFlat, notifyUsers } from '../notifications/notify.service';
import { Flat } from '../society/society.model';
import { realtime } from '../../realtime/socket';
import { Guard } from '../guard/guard.model';
import { EmergencyAlarmLock, EmergencyAlert, EmergencyContact, EmergencyStaffMessage, LostFoundItem, SecurityIncident } from './emergency.model';

export const emergencyService = {
  async raise(a: { societyId: string; userId: string; source: 'RESIDENT' | 'GUARD'; gateId?: string }, body: any) {
    let flatLabel: string | undefined;
    if (body.flatId) flatLabel = ((await Flat.findOne({ _id: body.flatId, societyId: a.societyId })) as any)?.label;
    const personal = a.source === 'RESIDENT' ? await EmergencyContact.find({ societyId: a.societyId, scope: 'PERSONAL', ownerUserId: a.userId }).limit(10) : [];
    const raiser: any = await User.findById(a.userId).select('name');
    const { confirm: _confirm, flat: _flat, ...fields } = body;
    const alert: any = await EmergencyAlert.create({ ...fields, societyId: a.societyId, source: a.source, raisedBy: a.userId, raisedByName: raiser?.name, createdBy: a.userId, gateId: a.gateId, flatLabel, notifiedContacts: personal.map((c: any) => ({ name: c.name, phone: c.phone })) });
    // `id/scope/societyId/flat/raisedById/raisedByName` follow the agreed socket contract; the older
    // keys (alertId, flatLabel) stay so existing app builds keep working.
    const payload = { id: String(alert._id), alertId: String(alert._id), scope: 'SOCIETY', societyId: a.societyId, type: alert.type, flat: flatLabel, flatLabel, location: body.location, message: body.message, source: a.source, raisedById: a.userId, raisedByName: raiser?.name, raisedAt: alert.createdAt };
    realtime.toGuards(a.societyId, 'emergency:alert', payload);
    realtime.toAdmins(a.societyId, 'emergency:alert', payload);
    const guards: any[] = await Guard.find({ societyId: a.societyId, status: 'ACTIVE' }).select('userId');
    await notifyUsers({ societyId: a.societyId, userIds: guards.map((g) => g.userId).filter((u) => String(u) !== a.userId), type: NotificationType.EMERGENCY, title: `EMERGENCY: ${alert.type}`, body: `${flatLabel ?? body.location ?? 'Society'} - ${body.message ?? 'Immediate assistance needed'}`, data: payload });
    await notifyAdmins(a.societyId, 'emergency:manage', { type: NotificationType.EMERGENCY, title: `EMERGENCY: ${alert.type}`, body: `${flatLabel ?? body.location ?? 'Society'} - ${body.message ?? ''}`, data: payload, event: 'emergency:alert' });
    if (a.source === 'GUARD' && body.flatId) await notifyFlat(a.societyId, body.flatId, { type: NotificationType.EMERGENCY, title: `EMERGENCY: ${alert.type}`, body: body.message ?? 'Security alert for your flat', data: payload, event: 'emergency:alert' });
    personal.forEach((c: any) => logger.info('emergency_contact_to_notify', { alertId: String(alert._id), contactId: String(c._id) }));
    return alert;
  },
  async list(societyId: string, q: any, scope: Record<string, unknown> = {}) {
    const f: Record<string, unknown> = { societyId, ...scope };
    ['status', 'type'].forEach((k) => q[k] && (f[k] = q[k]));
    return paginate(EmergencyAlert, applyListFilters(f, q, ['message', 'flatLabel']), q, { sortable: ['createdAt', 'status'] });
  },
  /** Admin view: adds the raiser's contact number (guards and residents never get it). */
  async listForAdmin(societyId: string, q: any) {
    const r = await emergencyService.list(societyId, q);
    const ids = [...new Set(r.items.map((x: any) => String(x.raisedBy)))];
    const users: any[] = await User.find({ _id: { $in: ids } }).select('name mobile');
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return { ...r, items: r.items.map((x: any) => ({ ...x.toJSON(), raisedByName: x.raisedByName ?? byId.get(String(x.raisedBy))?.name, raisedByMobile: byId.get(String(x.raisedBy))?.mobile })) };
  },
  /** Resident -> guards or admins message. Max 5 per minute per resident. */
  async staffMessage(a: { societyId: string; userId: string; flatIds: string[] }, body: { audience: 'GUARDS' | 'ADMIN'; message: string; subject?: string }) {
    if ((await EmergencyStaffMessage.countDocuments({ societyId: a.societyId, fromUserId: a.userId, createdAt: { $gte: new Date(Date.now() - 60000) } })) >= 5) throw ApiError.tooMany('Too many messages, please wait a minute', 'MESSAGE_RATE_LIMITED');
    const [user, flat]: any[] = await Promise.all([User.findById(a.userId).select('name'), a.flatIds[0] ? Flat.findOne({ _id: a.flatIds[0], societyId: a.societyId }).select('label') : null]);
    const doc: any = await EmergencyStaffMessage.create({ societyId: a.societyId, fromUserId: a.userId, fromName: user?.name, flatLabel: flat?.label, audience: body.audience, subject: body.subject, message: body.message });
    const title = body.subject?.trim() || 'Emergency message';
    const text = `${user?.name ?? 'Resident'}${flat?.label ? ` (${flat.label})` : ''}: ${body.message.slice(0, 140)}`;
    const data = { messageId: String(doc._id), fromUserId: a.userId, fromName: user?.name, flat: flat?.label, audience: body.audience };
    if (body.audience === 'GUARDS') {
      const guards: any[] = await Guard.find({ societyId: a.societyId, status: 'ACTIVE' }).select('userId');
      await notifyUsers({ societyId: a.societyId, userIds: guards.map((g) => g.userId), type: NotificationType.EMERGENCY, title, body: text, data, event: 'emergency:message' });
      realtime.toGuards(a.societyId, 'emergency:message', { title, body: text, ...data });
    } else {
      await notifyAdmins(a.societyId, 'emergency:manage', { type: NotificationType.EMERGENCY, title, body: text, data, event: 'emergency:message' });
    }
    return doc;
  },
  async staffMessages(societyId: string, q: any) {
    const f: Record<string, unknown> = { societyId };
    if (q.audience) f.audience = q.audience;
    return paginate(EmergencyStaffMessage, applyListFilters(f, q, ['message', 'subject', 'fromName']), q, { sortable: ['createdAt'] });
  },
  /**
   * One-tap resident alarm. The resident is already authenticated and belongs to this society (auth
   * context). Only the resident's own flats are accepted. A short atomic lock stops duplicate alarms.
   */
  async raiseAlarm(a: { societyId: string; userId: string; flatIds: string[] }, body: any) {
    let flatId: string | undefined = body.flatId;
    if (!flatId && body.flat) {
      const f: any = await Flat.findOne({ societyId: a.societyId, _id: { $in: a.flatIds }, label: body.flat }).select('_id');
      flatId = f ? String(f._id) : undefined;
    }
    if (flatId && !a.flatIds.includes(flatId)) throw ApiError.forbidden('That flat does not belong to you', 'FLAT_FORBIDDEN');
    flatId = flatId ?? a.flatIds[0];

    const key = `${a.societyId}:${a.userId}`;
    const now = new Date();
    const cutoff = new Date(now.getTime() - env.EMERGENCY_DEDUPE_SECONDS * 1000);
    let claimed = true;
    try {
      const lock = await EmergencyAlarmLock.findOneAndUpdate(
        { _id: key, $or: [{ lastAlarmAt: { $lt: cutoff } }, { lastAlarmAt: null }] } as any,
        { $set: { lastAlarmAt: now, userId: a.userId, societyId: a.societyId } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).setOptions({ skipTenantCheck: true });
      claimed = Boolean(lock);
    } catch (err: any) {
      if (err?.code !== 11000) throw err; // lock exists and is still fresh => duplicate tap
      claimed = false;
    }
    if (!claimed) {
      const existing: any = await EmergencyAlert.findOne({ societyId: a.societyId, raisedBy: a.userId, status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] } }).sort({ createdAt: -1 });
      if (existing) return { alert: existing, duplicate: true };
    }
    try {
      const { flat: _f, ...rest } = body;
      const alert = await emergencyService.raise({ societyId: a.societyId, userId: a.userId, source: 'RESIDENT' }, { ...rest, flatId });
      return { alert, duplicate: false };
    } catch (err) {
      await EmergencyAlarmLock.updateOne({ _id: key }, { $set: { lastAlarmAt: null } }).setOptions({ skipTenantCheck: true });
      throw err;
    }
  },
  async update(societyId: string, id: string, userId: string, body: { status: string; note?: string }, actor: { role?: string } = {}) {
    const who: any = await User.findById(userId).select('name');
    const set: Record<string, unknown> = { status: body.status, updatedBy: userId };
    if (body.status === 'ACKNOWLEDGED') Object.assign(set, { acknowledgedBy: userId, acknowledgedByName: who?.name, acknowledgedByRole: actor.role, acknowledgedAt: new Date() });
    else Object.assign(set, { resolvedBy: userId, resolvedByName: who?.name, resolvedByRole: actor.role, resolvedAt: new Date(), resolutionNote: body.note });
    const from = body.status === 'ACKNOWLEDGED' ? ['ACTIVE'] : ['ACTIVE', 'ACKNOWLEDGED'];
    const a: any = await EmergencyAlert.findOneAndUpdate({ _id: id, societyId, status: { $in: from } }, { $set: set }, { new: true });
    if (!a) throw ApiError.conflict('Alert not found or cannot move to this state', 'INVALID_STATE');
    realtime.toSociety(societyId, 'emergency:updated', { alertId: id, id, status: a.status, byName: who?.name, byRole: actor.role });
    return a;
  },
};

export const incidentService = createCrudService({ model: SecurityIncident, name: 'Incident', searchFields: ['description', 'location'], filterable: ['status', 'type'], sortable: ['createdAt', 'status'] });
export const lostFoundService = createCrudService({ model: LostFoundItem, name: 'Lost & found item', searchFields: ['title', 'description'], filterable: ['type', 'status'], sortable: ['createdAt'] });
export const contactService = createCrudService({ model: EmergencyContact, name: 'Emergency contact', searchFields: ['name', 'category'], sortable: ['order', 'name'], defaultSort: 'order' });

export async function reportIncident(societyId: string, userId: string, role: string, body: any) {
  const doc: any = await incidentService.create(societyId, userId, { ...body, reportedBy: userId, reporterRole: role });
  await notifyAdmins(societyId, 'security:manage', { type: NotificationType.EMERGENCY, title: 'Security incident reported', body: `${body.type.replace('_', ' ').toLowerCase()}: ${body.description.slice(0, 100)}`, data: { incidentId: String(doc._id) }, event: 'incident:reported' });
  return doc;
}
