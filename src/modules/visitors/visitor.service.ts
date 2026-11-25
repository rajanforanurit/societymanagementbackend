import { ApprovalMode, NotificationType, VisitorStatus } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { addMinutes, minutesOf, weekdayOf, ymd } from '../../common/utils/dates';
import { hmac, randomDigits, safeEqual } from '../../common/utils/crypto';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { writeAudit } from '../audit/audit.service';
import { notifyAdmins, notifyFlat, notifyUsers, residentUserIdsOfFlat } from '../notifications/notify.service';
import { Guard } from '../guard/guard.model';
import { Flat, Society } from '../society/society.model';
import { purgeFile } from '../files/files.service';
import { realtime } from '../../realtime/socket';
import { Visitor, VisitorInvitation } from './visitor.model';
import { GATE_PASS_DAYS } from './visitor.schema';

/** How long a finished visitor record stays in the database. */
const RETENTION_DAYS = 90;
/** Records still in play — never purged regardless of age. */
const LIVE_STATUSES = [VisitorStatus.PENDING_APPROVAL, VisitorStatus.APPROVED, VisitorStatus.CHECKED_IN];

const qrFor = (invId: string) => `${invId}.${hmac(`inv:${invId}`).slice(0, 24)}`;
const policyOf = async (societyId: string) => ((await Society.findById(societyId).select('settings.visitorPolicy')) as any)?.settings?.visitorPolicy ?? {};

/** Set VISITOR_PUSH_DATA_ONLY=true once the resident app renders its own full-screen card from a data message. */
const DATA_ONLY = process.env.VISITOR_PUSH_DATA_ONLY === 'true';

const guardUserIds = async (societyId: string): Promise<string[]> =>
  ((await Guard.find({ societyId, status: 'ACTIVE' }).select('userId')) as any[]).map((g) => String(g.userId));

/** Payload the resident app uses to draw the approval card (lock screen, sleeping, or in-app). */
const approvalData = (v: any, requiresApproval: boolean) => ({
  kind: 'VISITOR_APPROVAL',
  visitorId: String(v._id),
  requiresApproval,
  name: v.name,
  visitorType: v.visitorType,
  company: v.company ?? '',
  purpose: v.purpose ?? '',
  flatLabel: v.flatLabel,
  photoFileId: v.photoFileId ? String(v.photoFileId) : undefined,
  requestedAt: (v.requestedAt ?? new Date()).toISOString?.() ?? String(v.requestedAt),
});

/** Tell every other device of the flat that the card is no longer actionable. */
const dismissApproval = async (societyId: string, v: any, decision: string) => {
  const userIds = await residentUserIdsOfFlat(societyId, String(v.flatId));
  await notifyUsers({ societyId, userIds, type: NotificationType.VISITOR, title: 'Visitor resolved', body: decision, data: { kind: 'VISITOR_RESOLVED', visitorId: String(v._id), decision }, skipInbox: true, push: { silent: true } });
};

/** Push + socket to every on-duty guard (the decision came back from the flat). */
const tellGuards = async (societyId: string, v: any, title: string, body: string, event: string, extra: Record<string, unknown> = {}) => {
  const userIds = await guardUserIds(societyId);
  await notifyUsers({ societyId, userIds, type: NotificationType.VISITOR, title, body, data: { visitorId: String(v._id), flatLabel: v.flatLabel, ...extra }, event, push: { urgent: true } });
};

const gateBoard = (societyId: string, event: string, v: any) =>
  realtime.toAdmins(societyId, event, { visitorId: String(v._id), name: v.name, flatLabel: v.flatLabel, visitorType: v.visitorType });

const GUEST_FIELDS = 'gateId flatId flatLabel visitorType name mobile vehicleNumber purpose company photoFileId status approvalMode requestedAt decidedAt rejectReason entryAt exitAt isEmergencyEntry createdAt updatedAt societyId';

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
    await notifyFlat(
      a.societyId,
      input.flatId,
      {
        type: NotificationType.VISITOR,
        title: needs ? 'Visitor at the gate' : 'Visitor entering',
        body: `${input.name} (${input.visitorType.toLowerCase().replace('_', ' ')}) ${needs ? 'is waiting for your approval' : 'was allowed by society policy'}.`,
        data: approvalData(doc, needs),
        event: 'visitor:arrived',
        push: needs ? { urgent: true, dataOnly: DATA_ONLY } : undefined,
      },
      'canApproveVisitors',
    );
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
      if (!inv) await visitorService.explainInactive(a.societyId, { _id: id });
    } else {
      inv = await VisitorInvitation.findOne({ societyId: a.societyId, code: input.code, status: 'ACTIVE' });
      if (!inv) await visitorService.explainInactive(a.societyId, { code: input.code });
    }
    if (!inv) throw ApiError.badRequest('Pass not found or no longer active', 'INVALID_PASS');
    const now = new Date();
    if (now > inv.validTo) {
      await VisitorInvitation.updateOne({ _id: inv._id, societyId: a.societyId, status: 'ACTIVE' }, { $set: { status: 'EXPIRED' } });
      throw ApiError.badRequest(inv.kind === 'GATE_PASS' ? `This gate pass expired on ${inv.validTo.toISOString().slice(0, 10)}` : 'Pass has expired', 'PASS_EXPIRED');
    }
    if (now < inv.validFrom) throw ApiError.badRequest('Pass is outside its validity window', 'PASS_NOT_VALID_NOW');
    if (inv.recurring?.enabled) {
      if (!inv.recurring.days.includes(weekdayOf(ymd(now)))) throw ApiError.badRequest('Pass is not valid today', 'PASS_NOT_VALID_TODAY');
      const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
      if (inv.recurring.timeFrom && mins < minutesOf(inv.recurring.timeFrom)) throw ApiError.badRequest('Pass is not valid yet today', 'PASS_NOT_VALID_NOW');
      if (inv.recurring.timeTo && mins > minutesOf(inv.recurring.timeTo)) throw ApiError.badRequest('Pass has expired for today', 'PASS_NOT_VALID_NOW');
    }
    const bump = await VisitorInvitation.updateOne({ _id: inv._id, societyId: a.societyId, status: 'ACTIVE', ...(inv.maxEntries > 0 ? { usedEntries: { $lt: inv.maxEntries } } : {}) }, { $inc: { usedEntries: 1 } });
    if (bump.modifiedCount !== 1) throw ApiError.conflict('Pass has no remaining entries', 'PASS_EXHAUSTED');
    if (inv.maxEntries > 0 && inv.usedEntries + 1 >= inv.maxEntries) await VisitorInvitation.updateOne({ _id: inv._id, societyId: a.societyId }, { $set: { status: 'EXHAUSTED' } });
    const isGatePass = inv.kind === 'GATE_PASS';
    const purpose = isGatePass ? ['Gate pass', inv.relation].filter(Boolean).join(' · ') : inv.purpose;
    const doc: any = await Visitor.create({ societyId: a.societyId, gateId: a.gateId, flatId: inv.flatId, flatLabel: inv.flatLabel, visitorType: inv.visitorType, name: inv.visitorName, mobile: inv.visitorMobile, vehicleNumber: inv.vehicleNumber, purpose, status: VisitorStatus.APPROVED, approvalMode: ApprovalMode.PRE_APPROVED, invitationId: inv._id, decidedAt: now, createdBy: a.userId });
    await notifyFlat(a.societyId, String(inv.flatId), { type: NotificationType.VISITOR, title: isGatePass ? 'Gate pass used' : 'Pre-approved visitor arrived', body: `${inv.visitorName}${inv.relation ? ` (${inv.relation})` : ''} arrived with a valid ${isGatePass ? 'gate pass' : 'pass'}.`, data: { visitorId: String(doc._id) }, event: 'visitor:arrived' });
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
    const inside: any = await visitorService.getFor(a.societyId, id);
    gateBoard(a.societyId, 'visitor:entered', inside);
    return inside;
  },

  async exit(a: { societyId: string; userId: string }, id: string) {
    const r = await Visitor.findOneAndUpdate({ _id: id, societyId: a.societyId, status: VisitorStatus.CHECKED_IN }, { $set: { status: VisitorStatus.CHECKED_OUT, exitAt: new Date(), exitedBy: a.userId } }, { new: true });
    if (!r) throw ApiError.conflict('Visitor is not currently checked in', 'NOT_CHECKED_IN');
    await notifyFlat(a.societyId, String(r.flatId), { type: NotificationType.VISITOR, title: 'Visitor left', body: `${r.name} has exited.`, data: { visitorId: id }, event: 'visitor:exited' });
    gateBoard(a.societyId, 'visitor:exited', r);
    return r;
  },

  async deny(a: { societyId: string; userId: string }, id: string, reason: string) {
    const r = await Visitor.findOneAndUpdate({ _id: id, societyId: a.societyId, status: { $in: [VisitorStatus.PENDING_APPROVAL, VisitorStatus.APPROVED] } }, { $set: { status: VisitorStatus.DENIED, rejectReason: reason, decidedAt: new Date(), decidedBy: a.userId } }, { new: true });
    if (!r) throw ApiError.conflict('Visitor cannot be denied in its current state', 'INVALID_STATE');
    await notifyFlat(a.societyId, String(r.flatId), { type: NotificationType.VISITOR, title: 'Entry denied by security', body: `${r.name} was denied entry: ${reason}`, data: { visitorId: id }, event: 'visitor:denied' });
    await dismissApproval(a.societyId, r, 'DENIED').catch(() => undefined);
    gateBoard(a.societyId, 'visitor:denied', r);
    return r;
  },

  async resend(a: { societyId: string }, id: string) {
    const v = await visitorService.getFor(a.societyId, id, { status: VisitorStatus.PENDING_APPROVAL });
    await notifyFlat(a.societyId, String(v.flatId), { type: NotificationType.VISITOR, title: 'Visitor still waiting', body: `${v.name} is waiting at the gate.`, data: approvalData(v, true), event: 'visitor:arrived', push: { urgent: true, dataOnly: DATA_ONLY } }, 'canApproveVisitors');
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
    gateBoard(a.societyId, 'visitor:decision', r);
    await dismissApproval(a.societyId, r, approve ? 'APPROVED' : 'REJECTED').catch(() => undefined);
    await tellGuards(
      a.societyId,
      r,
      approve ? 'Visitor approved' : 'Visitor declined',
      approve ? `${r.name} approved by ${r.flatLabel}. Allow entry.` : `${r.name} declined by ${r.flatLabel}${body.reason ? `: ${body.reason}` : ''}.`,
      'visitor:decision',
      { decision: body.decision, name: r.name, gateId: r.gateId ? String(r.gateId) : undefined },
    ).catch(() => undefined);
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
    // Expiry is swept by a job every minute; report it immediately in between.
    if (j.status === 'ACTIVE' && new Date(j.validTo) < new Date()) j.status = 'EXPIRED';
    return j;
  },

  /** Why a code / QR is not usable: gives the guard a precise reason instead of "not found". */
  async explainInactive(societyId: string, match: Record<string, unknown>) {
    const old: any = await VisitorInvitation.findOne({ societyId, ...match }).sort({ updatedAt: -1 });
    if (!old) return;
    if (old.status === 'EXPIRED') throw ApiError.badRequest(old.kind === 'GATE_PASS' ? `This gate pass expired on ${old.validTo.toISOString().slice(0, 10)}` : 'Pass has expired', 'PASS_EXPIRED');
    if (old.status === 'CANCELLED') throw ApiError.badRequest('This pass was cancelled by the resident', 'PASS_CANCELLED');
    if (old.status === 'EXHAUSTED') throw ApiError.conflict('Pass has no remaining entries', 'PASS_EXHAUSTED');
  },

  // ------------------------------------------------------------ gate passes

  /**
   * Create a 30-day gate pass (unique 6-digit code + signed QR token, both linked to the same pass).
   * If the flat already has a valid pass for the same person (same mobile, or same name when no
   * mobile is given), that pass is returned with reused=true instead of creating a duplicate.
   */
  async createGatePass(a: { societyId: string; userId: string; residents: { flatId: string }[] }, body: any) {
    const res = body.flatId ? a.residents.find((r) => r.flatId === body.flatId) : a.residents[0];
    if (!res) throw ApiError.forbidden('You do not belong to this flat', 'FLAT_FORBIDDEN');
    const now = new Date();
    const live = { societyId: a.societyId, flatId: res.flatId, kind: 'GATE_PASS', status: 'ACTIVE', validTo: { $gt: now } };
    const same = body.visitorMobile
      ? { visitorMobile: body.visitorMobile }
      : { visitorName: new RegExp(`^${body.visitorName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), $or: [{ visitorMobile: { $exists: false } }, { visitorMobile: null }, { visitorMobile: '' }] };
    const existing: any = await VisitorInvitation.findOne({ ...live, ...same }).sort({ validTo: -1 });
    if (existing) return { ...visitorService.invitationView(existing), reused: true };
    if ((await VisitorInvitation.countDocuments(live)) >= 100) throw ApiError.conflict('This flat already has 100 active gate passes. Revoke some before creating more.', 'TOO_MANY_PASSES');
    const flat = await flatCtx(a.societyId, res.flatId);
    const validTo = new Date(now.getTime() + GATE_PASS_DAYS * 24 * 60 * 60 * 1000);
    for (let i = 0; i < 5; i++) {
      try {
        const inv: any = await VisitorInvitation.create({
          societyId: a.societyId,
          flatId: res.flatId,
          flatLabel: flat.label,
          kind: 'GATE_PASS',
          visitorType: 'GUEST',
          visitorName: body.visitorName,
          visitorMobile: body.visitorMobile,
          relation: body.relation,
          vehicleNumber: body.vehicleNumber,
          purpose: body.relation ? `Gate pass · ${body.relation}` : 'Gate pass',
          validFrom: now,
          validTo,
          maxEntries: 0, // unlimited while valid
          code: randomDigits(6),
          createdBy: a.userId,
        });
        return { ...visitorService.invitationView(inv), reused: false };
      } catch (e: any) {
        if (e?.code !== 11000) throw e;
      }
    }
    throw ApiError.conflict('Could not allocate a unique pass code, retry', 'CODE_COLLISION');
  },

  async listGatePasses(societyId: string, flatIds: string[], query: any) {
    const now = new Date();
    const filter: Record<string, unknown> = { societyId, flatId: { $in: flatIds }, kind: 'GATE_PASS' };
    if (query.status === 'ACTIVE') Object.assign(filter, { status: 'ACTIVE', validTo: { $gt: now } });
    else if (query.status === 'EXPIRED') Object.assign(filter, { $or: [{ status: 'EXPIRED' }, { status: 'ACTIVE', validTo: { $lte: now } }] });
    else filter.status = query.status;
    const r = await paginate(VisitorInvitation, applyListFilters(filter, query, ['visitorName', 'relation', 'visitorMobile']), query, { sortable: ['createdAt', 'validTo', 'visitorName'], defaultSort: query.status === 'ACTIVE' ? 'validTo' : '-validTo' });
    return { ...r, items: r.items.map((i: any) => visitorService.invitationView(i)) };
  },

  /** Any resident of the flat can revoke a gate pass (family members share them). */
  async revokeGatePass(societyId: string, flatIds: string[], userId: string, id: string) {
    const r = await VisitorInvitation.findOneAndUpdate({ _id: id, societyId, flatId: { $in: flatIds }, kind: 'GATE_PASS', status: 'ACTIVE' }, { $set: { status: 'CANCELLED', updatedBy: userId } }, { new: true });
    if (!r) throw ApiError.notFound('Active gate pass not found');
    return visitorService.invitationView(r);
  },

  /** Job: mark every pass whose validity has ended as EXPIRED (QR and code stop working together). */
  async expireInvitations() {
    const r = await VisitorInvitation.updateMany({ status: 'ACTIVE', validTo: { $lt: new Date() } }, { $set: { status: 'EXPIRED' } }).setOptions({ skipTenantCheck: true });
    return r.modifiedCount;
  },
  async listInvitations(societyId: string, query: any, scope: Record<string, unknown> = {}) {
    const filter: Record<string, unknown> = { societyId, ...scope };
    ['status', 'flatId', 'kind'].forEach((k) => query[k] && (filter[k] = query[k]));
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
    const list: any[] = await VisitorInvitation.find({ societyId, status: 'ACTIVE', kind: { $ne: 'GATE_PASS' }, validTo: { $gte: now }, validFrom: { $lte: addMinutes(now, 24 * 60) } }).select('flatLabel visitorName visitorType validFrom validTo').sort({ validFrom: 1 }).limit(100);
    return list.map((i) => ({ id: String(i._id), flatLabel: i.flatLabel, visitorName: i.visitorName, visitorType: i.visitorType, validFrom: i.validFrom, validTo: i.validTo }));
  },

  async processTimeouts() {
    const societies: any[] = await Society.find({ status: 'ACTIVE' }).select('settings.visitorPolicy');
    for (const s of societies) {
      const p = s.settings?.visitorPolicy ?? {};
      const cutoff = new Date(Date.now() - (p.approvalTimeoutSeconds ?? 30 * 60) * 1000);
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

  /**
   * Retention: finished visitor records leave the database after
   * [RETENTION_DAYS]. The visitor log is the highest-volume, lowest-value
   * collection in the long run — yesterday's deliveries and gate walks have
   * no operational meaning a season later — so history is deleted outright
   * rather than archived.
   *
   * A record is finished when its status is no longer live (checked out,
   * denied, rejected, cancelled, expired or a stale expectation) AND its last
   * activity (exit, otherwise decision, otherwise creation) is older than the
   * cutoff. Anything pending, approved or still inside is kept no matter how
   * old — the guard's queue is the source of truth for a live entry.
   *
   * The visitor's photo (a purpose=VISITOR file) is deleted with the record
   * once no other record references it, so storage does not grow forever
   * either. Runs hourly from the scheduler.
   */
  async purgeExpired() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const stale: any[] = await Visitor.find({
      status: { $nin: LIVE_STATUSES },
      $or: [
        { exitAt: { $ne: null, $lt: cutoff } },
        { exitAt: null, decidedAt: { $ne: null, $lt: cutoff } },
        { exitAt: null, decidedAt: null, createdAt: { $lt: cutoff } },
      ],
    })
      .select('photoFileId')
      .limit(2000)
      .lean();
    if (stale.length === 0) return 0;

    const ids = stale.map((v) => v._id);
    const photoIds = [...new Set(stale.map((v) => v.photoFileId).filter(Boolean).map(String))];

    await Visitor.deleteMany({ _id: { $in: ids } });

    if (photoIds.length > 0) {
      const stillReferenced = new Set(
        (await Visitor.distinct('photoFileId', { photoFileId: { $in: photoIds } })).map(String),
      );
      const orphans = photoIds.filter((id) => !stillReferenced.has(id));
      for (const id of orphans) {
        await purgeFile(id).catch(() => undefined);
      }
    }

    return stale.length;
  },
};
