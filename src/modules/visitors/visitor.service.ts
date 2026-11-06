import { ApprovalMode, NotificationType, VisitorStatus } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { addMinutes, minutesOf, weekdayOf, ymd } from '../../common/utils/dates';
import { hmac, randomDigits, safeEqual } from '../../common/utils/crypto';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { writeAudit } from '../audit/audit.service';
import { notifyAdmins, notifyFlat } from '../notifications/notify.service';
import { Flat, Society } from '../society/society.model';
import { realtime } from '../../realtime/socket';
import { Visitor, VisitorInvitation } from './visitor.model';

const qrFor = (invId: string) => `${invId}.${hmac(`inv:${invId}`).slice(0, 24)}`;
const policyOf = async (societyId: string) => ((await Society.findById(societyId).select('settings.visitorPolicy')) as any)?.settings?.visitorPolicy ?? {};

const GUEST_FIELDS = 'gateId flatId flatLabel visitorType name mobile vehicleNumber purpose company status approvalMode requestedAt decidedAt rejectReason entryAt exitAt isEmergencyEntry createdAt updatedAt societyId';

const flatCtx = async (societyId: string, flatId: string) => {
  const flat: any = await Flat.findOne({ _id: flatId, societyId });
  if (!flat) throw ApiError.notFound('Flat not found');
  return flat;
};

export const visitorService = {
  guardFields: GUEST_FIELDS,

  async lookupFlats(societyId: string, q: string, limit: number) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const flats: any[] = await Flat.find({ societyId, $or: [{ label: rx }, { unitNumber: rx }] }).select('label towerId floorNumber').limit(limit);
    return flats.map((f) => ({ id: String(f._id), label: f.label, towerId: f.towerId ? String(f.towerId) : undefined, floorNumber: f.floorNumber }));
  },

  async register(a: { societyId: string; userId: string; gateId?: string }, input: any) {
    const flat = await flatCtx(a.societyId, input.flatId);
    const policy = await policyOf(a.societyId);
    if (policy.requirePhoto && !input.photoFileId) throw ApiError.badRequest('Policy requires a visitor photograph', 'PHOTO_REQUIRED');
    const needs = policy.approvalRequired?.[input.visitorType] !== false;
    const doc: any = await Visitor.create({
      ...input,
      societyId: a.societyId,
      gateId: a.gateId,
      flatLabel: flat.label,
      status: needs ? VisitorStatus.PENDING_APPROVAL : VisitorStatus.APPROVED,
      approvalMode: needs ? undefined : ApprovalMode.POLICY_AUTO,
      decidedAt: needs ? undefined : new Date(),
      createdBy: a.userId,
    });
    await notifyFlat(a.societyId, input.flatId, { type: NotificationType.VISITOR, title: needs ? 'Visitor at the gate' : 'Visitor entering', body: `${input.name} (${input.visitorType.toLowerCase().replace('_', ' ')}) ${needs ? 'is waiting for your approval' : 'was allowed by society policy'}.`, data: { visitorId: String(doc._id), requiresApproval: needs }, event: 'visitor:arrived' }, 'canApproveVisitors');
    return doc;
  },

  async verifyPass(a: { societyId: string; userId: string; gateId?: string }, input: { code?: string; qrToken?: string }) {
    const policy = await policyOf(a.societyId);
    if (policy.allowPreApproved === false) throw ApiError.forbidden('Pre-approved entry is disabled by society policy', 'PREAPPROVAL_DISABLED');
    let inv: any;
    if (input.qrToken) {
      const [id, sig] = input.qrToken.split('.');
      if (!id || !sig || !/^[a-f\d]{24}$/i.test(id) || !safeEqual(sig, hmac(`inv:${id}`).slice(0, 24))) throw ApiError.badRequest('Invalid QR pass', 'INVALID_PASS');
      inv = await VisitorInvitation.findOne({ _id: id, societyId: a.societyId, status: 'ACTIVE' });
    } else inv = await VisitorInvitation.findOne({ societyId: a.societyId, code: input.code, status: 'ACTIVE' });
    if (!inv) throw ApiError.badRequest('Pass not found or no longer active', 'INVALID_PASS');
    const now = new Date();
    if (now < inv.validFrom || now > inv.validTo) throw ApiError.badRequest('Pass is outside its validity window', 'PASS_NOT_VALID_NOW');
    if (inv.recurring?.enabled) {
      if (!inv.recurring.days.includes(weekdayOf(ymd(now)))) throw ApiError.badRequest('Pass is not valid today', 'PASS_NOT_VALID_TODAY');
      const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
      if (inv.recurring.timeFrom && mins < minutesOf(inv.recurring.timeFrom)) throw ApiError.badRequest('Pass is not valid yet today', 'PASS_NOT_VALID_NOW');
      if (inv.recurring.timeTo && mins > minutesOf(inv.recurring.timeTo)) throw ApiError.badRequest('Pass has expired for today', 'PASS_NOT_VALID_NOW');
    }
    const bump = await VisitorInvitation.updateOne({ _id: inv._id, societyId: a.societyId, status: 'ACTIVE', ...(inv.maxEntries > 0 ? { usedEntries: { $lt: inv.maxEntries } } : {}) }, { $inc: { usedEntries: 1 } });
    if (bump.modifiedCount !== 1) throw ApiError.conflict('Pass has no remaining entries', 'PASS_EXHAUSTED');
    if (inv.maxEntries > 0 && inv.usedEntries + 1 >= inv.maxEntries) await VisitorInvitation.updateOne({ _id: inv._id, societyId: a.societyId }, { $set: { status: 'EXHAUSTED' } });
    const doc: any = await Visitor.create({ societyId: a.societyId, gateId: a.gateId, flatId: inv.flatId, flatLabel: inv.flatLabel, visitorType: inv.visitorType, name: inv.visitorName, mobile: inv.visitorMobile, vehicleNumber: inv.vehicleNumber, purpose: inv.purpose, status: VisitorStatus.APPROVED, approvalMode: ApprovalMode.PRE_APPROVED, invitationId: inv._id, decidedAt: now, createdBy: a.userId });
    await notifyFlat(a.societyId, String(inv.flatId), { type: NotificationType.VISITOR, title: 'Pre-approved visitor arrived', body: `${inv.visitorName} arrived with a valid pass.`, data: { visitorId: String(doc._id) }, event: 'visitor:arrived' });
    return doc;
  },

  async getFor(societyId: string, id: string, extra: Record<string, unknown> = {}) {
    const v: any = await Visitor.findOne({ _id: id, societyId, ...extra });
    if (!v) throw ApiError.notFound('Visitor not found');
    return v;
  },

  async entry(a: { societyId: string; userId: string; gateId?: string }, id: string) {
    const v = await visitorService.getFor(a.societyId, id);
    const policy = await policyOf(a.societyId);
    let mode = v.approvalMode;
    if (v.status === VisitorStatus.PENDING_APPROVAL) {
      const waited = (Date.now() - v.requestedAt.getTime()) / 1000;
      if (policy.onTimeout === 'ALLOW' && waited >= (policy.approvalTimeoutSeconds ?? 120)) mode = ApprovalMode.TIMEOUT_ALLOWED;
      else throw ApiError.conflict('Resident approval is required before entry', 'APPROVAL_REQUIRED');
    } else if (v.status !== VisitorStatus.APPROVED) throw ApiError.conflict(`Visitor is ${v.status}; entry not permitted`, 'ENTRY_NOT_ALLOWED');
    const r = await Visitor.updateOne({ _id: id, societyId: a.societyId, status: { $in: [VisitorStatus.APPROVED, VisitorStatus.PENDING_APPROVAL] } }, { $set: { status: VisitorStatus.CHECKED_IN, entryAt: new Date(), enteredBy: a.userId, approvalMode: mode, gateId: a.gateId ?? v.gateId } });
    if (r.modifiedCount !== 1) throw ApiError.conflict('Visitor state changed', 'CONCURRENT_UPDATE');
    await notifyFlat(a.societyId, String(v.flatId), { type: NotificationType.VISITOR, title: 'Visitor entered', body: `${v.name} has entered the premises.`, data: { visitorId: id }, event: 'visitor:entered' });
    return visitorService.getFor(a.societyId, id);
  },

  async exit(a: { societyId: string; userId: string }, id: string) {
    const r = await Visitor.findOneAndUpdate({ _id: id, societyId: a.societyId, status: VisitorStatus.CHECKED_IN }, { $set: { status: VisitorStatus.CHECKED_OUT, exitAt: new Date(), exitedBy: a.userId } }, { new: true });
    if (!r) throw ApiError.conflict('Visitor is not currently checked in', 'NOT_CHECKED_IN');
    await notifyFlat(a.societyId, String(r.flatId), { type: NotificationType.VISITOR, title: 'Visitor left', body: `${r.name} has exited.`, data: { visitorId: id }, event: 'visitor:exited' });
    return r;
  },

  async deny(a: { societyId: string; userId: string }, id: string, reason: string) {
    const r = await Visitor.findOneAndUpdate({ _id: id, societyId: a.societyId, status: { $in: [VisitorStatus.PENDING_APPROVAL, VisitorStatus.APPROVED] } }, { $set: { status: VisitorStatus.DENIED, rejectReason: reason, decidedAt: new Date(), decidedBy: a.userId } }, { new: true });
    if (!r) throw ApiError.conflict('Visitor cannot be denied in its current state', 'INVALID_STATE');
    await notifyFlat(a.societyId, String(r.flatId), { type: NotificationType.VISITOR, title: 'Entry denied by security', body: `${r.name} was denied entry: ${reason}`, data: { visitorId: id }, event: 'visitor:denied' });
    return r;
  },

  async resend(a: { societyId: string }, id: string) {
    const v = await visitorService.getFor(a.societyId, id, { status: VisitorStatus.PENDING_APPROVAL });
    await notifyFlat(a.societyId, String(v.flatId), { type: NotificationType.VISITOR, title: 'Visitor still waiting', body: `${v.name} is waiting at the gate.`, data: { visitorId: String(v._id), requiresApproval: true }, event: 'visitor:arrived' }, 'canApproveVisitors');
    return v;
  },

  async emergencyEntry(a: { societyId: string; userId: string; gateId?: string }, input: any) {
    const policy = await policyOf(a.societyId);
    if (policy.allowEmergencyEntry === false) throw ApiError.forbidden('Emergency entry is disabled by society policy', 'EMERGENCY_ENTRY_DISABLED');
    const flat = await flatCtx(a.societyId, input.flatId);
    const { reason, ...rest } = input;
    const v: any = await Visitor.create({ ...rest, societyId: a.societyId, gateId: a.gateId, flatLabel: flat.label, status: VisitorStatus.CHECKED_IN, approvalMode: ApprovalMode.EMERGENCY, isEmergencyEntry: true, emergencyReason: reason, entryAt: new Date(), enteredBy: a.userId, createdBy: a.userId });
    await writeAudit({ actorId: a.userId, actorRole: 'GUARD', societyId: a.societyId, action: 'EMERGENCY_ENTRY', entityType: 'Visitor', entityId: String(v._id), metadata: { reason, flat: flat.label } });
    await notifyAdmins(a.societyId, 'visitor:read', { type: NotificationType.EMERGENCY, title: 'Emergency entry recorded', body: `${input.name} entered ${flat.label}: ${reason}`, data: { visitorId: String(v._id) }, event: 'visitor:emergency-entry' });
    await notifyFlat(a.societyId, input.flatId, { type: NotificationType.EMERGENCY, title: 'Emergency entry', body: `${input.name} was admitted without approval: ${reason}`, data: { visitorId: String(v._id) }, event: 'visitor:emergency-entry' });
    return v;
  },

  async respond(a: { societyId: string; userId: string; flatIds: string[]; residents: { flatId: string; permissions: Record<string, boolean> }[] }, id: string, body: { decision: string; reason?: string }) {
    const v = await visitorService.getFor(a.societyId, id);
    const mine = a.residents.find((r) => r.flatId === String(v.flatId));
    if (!mine) throw ApiError.notFound('Visitor not found');
    if (mine.permissions.canApproveVisitors === false) throw ApiError.forbidden('You are not permitted to approve visitors', 'RESIDENT_PERMISSION_DENIED');
    const approve = body.decision === 'APPROVE';
    const r = await Visitor.findOneAndUpdate({ _id: id, societyId: a.societyId, status: VisitorStatus.PENDING_APPROVAL }, { $set: { status: approve ? VisitorStatus.APPROVED : VisitorStatus.REJECTED, approvalMode: ApprovalMode.RESIDENT, decidedAt: new Date(), decidedBy: a.userId, rejectReason: approve ? undefined : body.reason } }, { new: true });
    if (!r) throw ApiError.conflict('Visitor is no longer awaiting approval', 'INVALID_STATE');
    const payload = { visitorId: id, decision: body.decision, name: r.name, flatLabel: r.flatLabel };
    if (r.gateId) realtime.toGate(String(r.gateId), 'visitor:decision', payload);
    realtime.toGuards(a.societyId, 'visitor:decision', payload);
    return r;
  },

  async list(societyId: string, query: any, scope: Record<string, unknown> = {}, select?: string) {
    const filter: Record<string, unknown> = { societyId, ...scope };
    ['status', 'visitorType', 'flatId', 'gateId', 'mobile'].forEach((k) => query[k] && (filter[k] = query[k]));
    return paginate(Visitor, applyListFilters(filter, query, ['name', 'mobile', 'vehicleNumber', 'flatLabel']), query, { sortable: ['createdAt', 'entryAt', 'exitAt', 'name'], select });
  },

  async createInvitation(a: { societyId: string; userId: string; residents: { flatId: string }[] }, body: any) {
    const res = body.flatId ? a.residents.find((r) => r.flatId === body.flatId) : a.residents[0];
    if (!res) throw ApiError.forbidden('You do not belong to this flat', 'FLAT_FORBIDDEN');
    if (new Date(body.validTo) <= new Date(body.validFrom)) throw ApiError.badRequest('validTo must be after validFrom');
    const flat = await flatCtx(a.societyId, res.flatId);
    for (let i = 0; i < 5; i++) {
      try {
        const inv: any = await VisitorInvitation.create({ ...body, flatId: res.flatId, flatLabel: flat.label, societyId: a.societyId, code: randomDigits(6), createdBy: a.userId });
        return visitorService.invitationView(inv);
      } catch (e: any) {
        if (e?.code !== 11000) throw e;
      }
    }
    throw ApiError.conflict('Could not allocate a unique pass code, retry', 'CODE_COLLISION');
  },
  invitationView(inv: any) {
    const j = inv.toJSON();
    j.qrToken = qrFor(String(inv._id));
    return j;
  },
  async listInvitations(societyId: string, query: any, scope: Record<string, unknown> = {}) {
    const filter: Record<string, unknown> = { societyId, ...scope };
    ['status', 'flatId'].forEach((k) => query[k] && (filter[k] = query[k]));
    const r = await paginate(VisitorInvitation, applyListFilters(filter, query, ['visitorName', 'flatLabel']), query, { sortable: ['createdAt', 'validFrom', 'validTo'] });
    return { ...r, items: r.items.map((i: any) => visitorService.invitationView(i)) };
  },
  async cancelInvitation(societyId: string, userId: string, id: string) {
    const r = await VisitorInvitation.findOneAndUpdate({ _id: id, societyId, createdBy: userId, status: 'ACTIVE' }, { $set: { status: 'CANCELLED' } }, { new: true });
    if (!r) throw ApiError.notFound('Active invitation not found');
    return visitorService.invitationView(r);
  },

  async expected(societyId: string) {
    const now = new Date();
    const list: any[] = await VisitorInvitation.find({ societyId, status: 'ACTIVE', validTo: { $gte: now }, validFrom: { $lte: addMinutes(now, 24 * 60) } }).select('flatLabel visitorName visitorType validFrom validTo').sort({ validFrom: 1 }).limit(100);
    return list.map((i) => ({ id: String(i._id), flatLabel: i.flatLabel, visitorName: i.visitorName, visitorType: i.visitorType, validFrom: i.validFrom, validTo: i.validTo }));
  },

  async processTimeouts() {
    const societies: any[] = await Society.find({ status: 'ACTIVE' }).select('settings.visitorPolicy');
    for (const s of societies) {
      const p = s.settings?.visitorPolicy ?? {};
      const cutoff = new Date(Date.now() - (p.approvalTimeoutSeconds ?? 120) * 1000);
      if (p.onTimeout === 'ALLOW') continue;
      const stale: any[] = await Visitor.find({ societyId: s._id, status: VisitorStatus.PENDING_APPROVAL, requestedAt: { $lt: cutoff } }).limit(100);
      for (const v of stale) {
        if (p.onTimeout === 'ESCALATE') {
          if (!v.overstayNotifiedAt) {
            await Visitor.updateOne({ _id: v._id, societyId: s._id }, { $set: { overstayNotifiedAt: new Date() } });
            await notifyAdmins(String(s._id), 'visitor:read', { type: NotificationType.VISITOR, title: 'Visitor approval timed out', body: `${v.name} has been waiting for ${v.flatLabel}.`, data: { visitorId: String(v._id) }, event: 'visitor:timeout' });
          }
        } else {
          await Visitor.updateOne({ _id: v._id, societyId: s._id, status: VisitorStatus.PENDING_APPROVAL }, { $set: { status: VisitorStatus.DENIED, rejectReason: 'Approval timed out', decidedAt: new Date() } });
        }
      }
      const overstayCut = new Date(Date.now() - (p.overstayMinutes ?? 240) * 60000);
      const over: any[] = await Visitor.find({ societyId: s._id, status: VisitorStatus.CHECKED_IN, entryAt: { $lt: overstayCut }, overstayNotifiedAt: null }).limit(100);
      for (const v of over) {
        await Visitor.updateOne({ _id: v._id, societyId: s._id }, { $set: { overstayNotifiedAt: new Date() } });
        await notifyFlat(String(s._id), String(v.flatId), { type: NotificationType.VISITOR, title: 'Visitor overstay', body: `${v.name} has stayed beyond the allowed time.`, data: { visitorId: String(v._id) }, event: 'visitor:overstay' });
        realtime.toGuards(String(s._id), 'visitor:overstay', { visitorId: String(v._id), name: v.name, flatLabel: v.flatLabel });
        await notifyAdmins(String(s._id), 'visitor:read', { type: NotificationType.VISITOR, title: 'Visitor overstay', body: `${v.name} (${v.flatLabel}) exceeded the allowed stay.`, data: { visitorId: String(v._id) }, event: 'visitor:overstay' });
      }
    }
    await VisitorInvitation.updateMany({ status: 'ACTIVE', validTo: { $lt: new Date() } }, { $set: { status: 'EXPIRED' } }).setOptions({ skipTenantCheck: true });
  },
};
