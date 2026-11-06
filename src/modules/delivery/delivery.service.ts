import { DeliveryStatus, NotificationType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { randomDigits, safeEqual, sha256 } from '../../common/utils/crypto';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { notifyFlat } from '../notifications/notify.service';
import { Flat, Society } from '../society/society.model';
import { realtime } from '../../realtime/socket';
import { Delivery } from './delivery.model';

type Guardish = { societyId: string; userId: string; gateId?: string };
const hash = (otp: string, id: string) => sha256(`${otp}:${id}`);

const load = async (societyId: string, id: string, extra: Record<string, unknown> = {}) => {
  const d: any = await Delivery.findOne({ _id: id, societyId, ...extra });
  if (!d) throw ApiError.notFound('Delivery not found');
  return d;
};

export const deliveryService = {
  async register(a: Guardish, input: any) {
    const flat: any = await Flat.findOne({ _id: input.flatId, societyId: a.societyId });
    if (!flat) throw ApiError.notFound('Flat not found');
    const policy: any = ((await Society.findById(a.societyId).select('settings.visitorPolicy')) as any)?.settings?.visitorPolicy ?? {};
    const pref = flat.deliveryPreference ?? {};
    const auto = pref.autoApprove === true || policy.deliveryApprovalRequired === false;
    const d: any = await Delivery.create({ ...input, societyId: a.societyId, gateId: a.gateId, flatLabel: flat.label, status: auto ? DeliveryStatus.APPROVED : DeliveryStatus.PENDING_APPROVAL, leaveAtGate: pref.leaveAtGate === true, handledBy: a.userId, createdBy: a.userId });
    await notifyFlat(a.societyId, input.flatId, { type: NotificationType.DELIVERY, title: `${input.company} delivery at the gate`, body: `${input.agentName} is here with a ${input.deliveryType.toLowerCase()} delivery.${auto ? ' Auto-approved per your preference.' : ' Approve, reject or choose leave-at-gate.'}`, data: { deliveryId: String(d._id), requiresApproval: !auto }, event: 'delivery:arrived' }, 'canApproveVisitors');
    return d;
  },
  async list(societyId: string, query: any, scope: Record<string, unknown> = {}) {
    const filter: Record<string, unknown> = { societyId, ...scope };
    ['status', 'flatId', 'deliveryType'].forEach((k) => query[k] && (filter[k] = query[k]));
    return paginate(Delivery, applyListFilters(filter, query, ['company', 'agentName', 'flatLabel']), query, { sortable: ['createdAt', 'entryAt'] });
  },
  get: load,
  async respond(a: { societyId: string; userId: string; residents: { flatId: string; permissions: Record<string, boolean> }[] }, id: string, body: { decision: string; reason?: string }) {
    const d = await load(a.societyId, id);
    const mine = a.residents.find((r) => r.flatId === String(d.flatId));
    if (!mine) throw ApiError.notFound('Delivery not found');
    if (mine.permissions.canApproveVisitors === false) throw ApiError.forbidden('You are not permitted to approve deliveries', 'RESIDENT_PERMISSION_DENIED');
    const status = body.decision === 'REJECT' ? DeliveryStatus.REJECTED : DeliveryStatus.APPROVED;
    const r = await Delivery.findOneAndUpdate({ _id: id, societyId: a.societyId, status: DeliveryStatus.PENDING_APPROVAL }, { $set: { status, leaveAtGate: body.decision === 'LEAVE_AT_GATE', rejectReason: body.decision === 'REJECT' ? body.reason : undefined, decidedAt: new Date(), decidedBy: a.userId } }, { new: true });
    if (!r) throw ApiError.conflict('Delivery is no longer awaiting a decision', 'INVALID_STATE');
    const payload = { deliveryId: id, decision: body.decision, company: r.company, flatLabel: r.flatLabel };
    if (r.gateId) realtime.toGate(String(r.gateId), 'delivery:decision', payload);
    realtime.toGuards(a.societyId, 'delivery:decision', payload);
    return r;
  },
  async entry(a: Guardish, id: string) {
    const r = await Delivery.findOneAndUpdate({ _id: id, societyId: a.societyId, status: DeliveryStatus.APPROVED, leaveAtGate: false }, { $set: { status: DeliveryStatus.ENTERED, entryAt: new Date(), handledBy: a.userId } }, { new: true });
    if (!r) throw ApiError.conflict('Delivery is not approved for entry (or is a leave-at-gate delivery)', 'ENTRY_NOT_ALLOWED');
    return r;
  },
  async exit(a: Guardish, id: string) {
    const r = await Delivery.findOneAndUpdate({ _id: id, societyId: a.societyId, status: DeliveryStatus.ENTERED }, { $set: { status: DeliveryStatus.EXITED, exitAt: new Date() } }, { new: true });
    if (!r) throw ApiError.conflict('Delivery has not entered', 'NOT_ENTERED');
    return r;
  },
  async leaveAtGate(a: Guardish, id: string) {
    const otp = randomDigits(6);
    const r = await Delivery.findOneAndUpdate({ _id: id, societyId: a.societyId, status: DeliveryStatus.APPROVED, leaveAtGate: true }, { $set: { status: DeliveryStatus.LEFT_AT_GATE, parcelReceivedAt: new Date(), parcelOtpHash: hash(otp, id), handledBy: a.userId } }, { new: true });
    if (!r) throw ApiError.conflict('Delivery is not approved for leave-at-gate', 'INVALID_STATE');
    await notifyFlat(a.societyId, String(r.flatId), { type: NotificationType.DELIVERY, title: 'Parcel left at the gate', body: `Your ${r.company} parcel is at the gate. Show collection OTP ${otp} to the guard.`, data: { deliveryId: id, collectionOtp: otp }, event: 'delivery:left-at-gate' }, 'canApproveVisitors');
    return r;
  },
  async handover(a: Guardish, id: string, otp: string) {
    const d: any = await Delivery.findOne({ _id: id, societyId: a.societyId, status: DeliveryStatus.LEFT_AT_GATE }).select('+parcelOtpHash');
    if (!d) throw ApiError.conflict('No parcel awaiting collection', 'INVALID_STATE');
    if (!safeEqual(hash(otp, id), d.parcelOtpHash)) throw ApiError.badRequest('Incorrect collection OTP', 'OTP_INVALID');
    const r = await Delivery.findOneAndUpdate({ _id: id, societyId: a.societyId, status: DeliveryStatus.LEFT_AT_GATE }, { $set: { status: DeliveryStatus.COLLECTED, collectedAt: new Date(), collectedBy: a.userId }, $unset: { parcelOtpHash: 1 } }, { new: true });
    return r;
  },
  async resend(a: { societyId: string }, id: string) {
    const d = await load(a.societyId, id, { status: DeliveryStatus.PENDING_APPROVAL });
    await notifyFlat(a.societyId, String(d.flatId), { type: NotificationType.DELIVERY, title: `${d.company} delivery waiting`, body: `${d.agentName} is waiting at the gate.`, data: { deliveryId: String(d._id), requiresApproval: true }, event: 'delivery:arrived' }, 'canApproveVisitors');
    return d;
  },
  async setPreference(societyId: string, flatId: string, body: { leaveAtGate?: boolean; autoApprove?: boolean }) {
    const set: Record<string, boolean> = {};
    if (body.leaveAtGate !== undefined) set['deliveryPreference.leaveAtGate'] = body.leaveAtGate;
    if (body.autoApprove !== undefined) set['deliveryPreference.autoApprove'] = body.autoApprove;
    const f: any = await Flat.findOneAndUpdate({ _id: flatId, societyId }, { $set: set }, { new: true });
    if (!f) throw ApiError.notFound('Flat not found');
    return { flatId, leaveAtGate: f.deliveryPreference?.leaveAtGate ?? false, autoApprove: f.deliveryPreference?.autoApprove ?? false };
  },
};
