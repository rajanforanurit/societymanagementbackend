import { NotificationType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { createCrudService } from '../../common/services/crud.service';
import { logger } from '../../common/utils/logger';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { notifyAdmins, notifyFlat, notifyUsers } from '../notifications/notify.service';
import { Flat } from '../society/society.model';
import { realtime } from '../../realtime/socket';
import { Guard } from '../guard/guard.model';
import { EmergencyAlert, EmergencyContact, LostFoundItem, SecurityIncident } from './emergency.model';

export const emergencyService = {
  async raise(a: { societyId: string; userId: string; source: 'RESIDENT' | 'GUARD'; gateId?: string }, body: any) {
    let flatLabel: string | undefined;
    if (body.flatId) flatLabel = ((await Flat.findOne({ _id: body.flatId, societyId: a.societyId })) as any)?.label;
    const personal = a.source === 'RESIDENT' ? await EmergencyContact.find({ societyId: a.societyId, scope: 'PERSONAL', ownerUserId: a.userId }).limit(10) : [];
    const alert: any = await EmergencyAlert.create({ ...body, societyId: a.societyId, source: a.source, raisedBy: a.userId, createdBy: a.userId, gateId: a.gateId, flatLabel, notifiedContacts: personal.map((c: any) => ({ name: c.name, phone: c.phone })) });
    const payload = { alertId: String(alert._id), type: alert.type, flatLabel, location: body.location, message: body.message, source: a.source };
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
  async update(societyId: string, id: string, userId: string, body: { status: string; note?: string }) {
    const set: Record<string, unknown> = { status: body.status, updatedBy: userId };
    if (body.status === 'ACKNOWLEDGED') Object.assign(set, { acknowledgedBy: userId, acknowledgedAt: new Date() });
    else Object.assign(set, { resolvedBy: userId, resolvedAt: new Date(), resolutionNote: body.note });
    const from = body.status === 'ACKNOWLEDGED' ? ['ACTIVE'] : ['ACTIVE', 'ACKNOWLEDGED'];
    const a: any = await EmergencyAlert.findOneAndUpdate({ _id: id, societyId, status: { $in: from } }, { $set: set }, { new: true });
    if (!a) throw ApiError.conflict('Alert not found or cannot move to this state', 'INVALID_STATE');
    realtime.toSociety(societyId, 'emergency:updated', { alertId: id, status: a.status });
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
