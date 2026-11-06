import { NotificationType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { randomDigits } from '../../common/utils/crypto';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { oid } from '../../common/utils/objectId';
import { ymd } from '../../common/utils/dates';
import { createCrudService } from '../../common/services/crud.service';
import { normalizeMobile } from '../auth/auth.service';
import { notifyAdmins, notifyFlat } from '../notifications/notify.service';
import { Flat } from '../society/society.model';
import { DomesticAttendance, DomesticHelp, DomesticPayment, ServiceProvider, ServiceReview } from './domestic.model';

type Res = { flatId: string }[];
const pickFlat = (residents: Res, flatId?: string) => {
  const r = flatId ? residents.find((x) => x.flatId === flatId) : residents[0];
  if (!r) throw ApiError.forbidden('You do not belong to this flat', 'FLAT_FORBIDDEN');
  return r.flatId;
};

export const domesticService = {
  async register(societyId: string, userId: string, residents: Res, body: any) {
    const flatId = pickFlat(residents, body.flatId);
    const flat: any = await Flat.findOne({ _id: flatId, societyId });
    const mobile = normalizeMobile(body.mobile);
    if (await DomesticHelp.exists({ societyId, mobile })) throw ApiError.conflict('A helper with this mobile number is already registered. Search the directory and hire instead.', 'HELP_EXISTS');
    for (let i = 0; i < 5; i++) {
      try {
        const h = await DomesticHelp.create({ societyId, registeredBy: userId, createdBy: userId, name: body.name, mobile, helpType: body.helpType, photoFileId: body.photoFileId, idProofFileId: body.idProofFileId, code: randomDigits(6), flats: [{ flatId, flatLabel: flat?.label, salaryMonthly: body.salaryMonthly }] });
        await notifyAdmins(societyId, 'domestic-help:manage', { type: NotificationType.APPROVAL, title: 'Domestic help awaiting verification', body: `${body.name} (${body.helpType.toLowerCase()}) registered for ${flat?.label}.`, data: { helpId: String(h._id) } });
        return h;
      } catch (e: any) {
        if (e?.code !== 11000 || e.keyPattern?.mobile) throw e;
      }
    }
    throw ApiError.conflict('Could not allocate entry code', 'CODE_COLLISION');
  },
  async mine(societyId: string, flatIds: string[], query: any) {
    return paginate(DomesticHelp, applyListFilters({ societyId, 'flats.flatId': { $in: flatIds.map(oid) } }, query, ['name']), query, { sortable: ['name', 'createdAt'] });
  },
  async directory(societyId: string, query: any) {
    const filter: Record<string, unknown> = { societyId, status: 'VERIFIED' };
    if (query.helpType) filter.helpType = query.helpType;
    const r = await paginate(DomesticHelp, applyListFilters(filter, query, ['name']), query, { sortable: ['ratingAvg', 'name'], select: 'name helpType ratingAvg ratingCount' });
    return { ...r, items: r.items.map((h: any) => ({ id: String(h._id), name: h.name, helpType: h.helpType, ratingAvg: h.ratingAvg, ratingCount: h.ratingCount })) };
  },
  async hire(societyId: string, residents: Res, id: string, body: any) {
    const flatId = pickFlat(residents, body.flatId);
    const flat: any = await Flat.findOne({ _id: flatId, societyId });
    const h = await DomesticHelp.findOneAndUpdate({ _id: id, societyId, status: 'VERIFIED', 'flats.flatId': { $ne: flatId } }, { $push: { flats: { flatId, flatLabel: flat?.label, salaryMonthly: body.salaryMonthly } } }, { new: true });
    if (!h) throw ApiError.conflict('Helper not found, not verified, or already assigned to your flat', 'CANNOT_HIRE');
    return h;
  },
  async release(societyId: string, residents: Res, id: string, flatId?: string) {
    const f = pickFlat(residents, flatId);
    const h = await DomesticHelp.findOneAndUpdate({ _id: id, societyId, 'flats.flatId': f }, { $pull: { flats: { flatId: f } } }, { new: true });
    if (!h) throw ApiError.notFound('Helper not assigned to your flat');
    return h;
  },
  async mark(societyId: string, userId: string, residents: Res, id: string, body: any) {
    const flatId = pickFlat(residents, body.flatId);
    const help = await DomesticHelp.findOne({ _id: id, societyId, 'flats.flatId': flatId });
    if (!help) throw ApiError.notFound('Helper not assigned to your flat');
    await DomesticAttendance.updateOne({ societyId, helpId: id, date: body.date }, { $setOnInsert: { marks: [], entries: [] } }, { upsert: true });
    await DomesticAttendance.updateOne({ societyId, helpId: id, date: body.date }, { $pull: { marks: { flatId } } });
    await DomesticAttendance.updateOne({ societyId, helpId: id, date: body.date }, { $push: { marks: { flatId, status: body.status, note: body.note, markedBy: userId } } });
    return DomesticAttendance.findOne({ societyId, helpId: id, date: body.date });
  },
  async attendance(societyId: string, flatIds: string[], id: string, q: any) {
    if (!(await DomesticHelp.exists({ _id: id, societyId, 'flats.flatId': { $in: flatIds } }))) throw ApiError.notFound('Helper not assigned to your flat');
    const filter: Record<string, any> = { societyId, helpId: id };
    if (q.from || q.to) filter.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    const r = await paginate(DomesticAttendance, filter, q, { sortable: ['date'], defaultSort: '-date' });
    return { ...r, items: r.items.map((a: any) => ({ ...a.toJSON(), marks: a.marks.filter((m: any) => flatIds.includes(String(m.flatId))) })) };
  },
  async pay(societyId: string, userId: string, residents: Res, id: string, body: any) {
    const flatId = pickFlat(residents, body.flatId);
    if (!(await DomesticHelp.exists({ _id: id, societyId, 'flats.flatId': flatId }))) throw ApiError.notFound('Helper not assigned to your flat');
    return DomesticPayment.create({ ...body, flatId, helpId: id, societyId, createdBy: userId });
  },
  async payments(societyId: string, flatIds: string[], id: string, q: any) {
    const filter: Record<string, unknown> = { societyId, helpId: id, flatId: { $in: flatIds } };
    if (q.month) filter.month = q.month;
    return paginate(DomesticPayment, applyListFilters(filter, q), q, { sortable: ['paidOn', 'createdAt'] });
  },
  async review(societyId: string, id: string, decision: string, reason: string | undefined, actorId: string) {
    const map: Record<string, string> = { VERIFY: 'VERIFIED', REJECT: 'REJECTED', SUSPEND: 'SUSPENDED' };
    if (decision !== 'VERIFY' && !reason) throw ApiError.badRequest('A reason is required', 'REASON_REQUIRED');
    const h: any = await DomesticHelp.findOneAndUpdate({ _id: id, societyId }, { $set: { status: map[decision], verifiedBy: actorId, verifiedAt: new Date(), rejectionReason: reason, updatedBy: actorId } }, { new: true });
    if (!h) throw ApiError.notFound('Domestic help not found');
    await notifyFlat(societyId, String(h.flats[0]?.flatId), { type: NotificationType.APPROVAL, title: `Domestic help ${map[decision].toLowerCase()}`, body: `${h.name} is now ${map[decision].toLowerCase()}.`, data: { helpId: id } }).catch(() => undefined);
    return h;
  },

  async guardFind(societyId: string, code: string) {
    const h: any = await DomesticHelp.findOne({ societyId, code });
    if (!h) throw ApiError.notFound('No domestic help found for this code');
    if (h.status !== 'VERIFIED') throw ApiError.forbidden(`Domestic help is ${h.status}; entry not permitted`, 'HELP_NOT_VERIFIED');
    const att: any = await DomesticAttendance.findOne({ societyId, helpId: h._id, date: ymd() });
    const open = att?.entries?.some((e: any) => e.checkInAt && !e.checkOutAt);
    return { id: String(h._id), name: h.name, helpType: h.helpType, status: h.status, assignedFlats: h.flats.map((f: any) => ({ flatId: String(f.flatId), flatLabel: f.flatLabel })), checkedIn: Boolean(open), _doc: h };
  },
  async checkIn(a: { societyId: string; userId: string; gateId?: string }, code: string) {
    const f = await domesticService.guardFind(a.societyId, code);
    if (f.checkedIn) throw ApiError.conflict('Already checked in', 'ALREADY_CHECKED_IN');
    const date = ymd();
    await DomesticAttendance.updateOne({ societyId: a.societyId, helpId: f.id, date }, { $setOnInsert: { marks: [], entries: [] } }, { upsert: true });
    await DomesticAttendance.updateOne({ societyId: a.societyId, helpId: f.id, date }, { $push: { entries: { gateId: a.gateId, checkInAt: new Date(), markedBy: a.userId } } });
    for (const fl of f.assignedFlats) await notifyFlat(a.societyId, fl.flatId, { type: NotificationType.VISITOR, title: 'Domestic help arrived', body: `${f.name} has checked in at the gate.`, data: { helpId: f.id }, event: 'domestic-help:checked-in' });
    const { _doc, ...view } = f;
    return { ...view, checkedIn: true };
  },
  async checkOut(a: { societyId: string; userId: string }, code: string) {
    const f = await domesticService.guardFind(a.societyId, code);
    const date = ymd();
    const r = await DomesticAttendance.updateOne({ societyId: a.societyId, helpId: f.id, date, entries: { $elemMatch: { checkOutAt: null, checkInAt: { $ne: null } } } }, { $set: { 'entries.$.checkOutAt': new Date() } });
    if (r.modifiedCount !== 1) throw ApiError.conflict('Not checked in', 'NOT_CHECKED_IN');
    for (const fl of f.assignedFlats) await notifyFlat(a.societyId, fl.flatId, { type: NotificationType.VISITOR, title: 'Domestic help left', body: `${f.name} has checked out.`, data: { helpId: f.id }, event: 'domestic-help:checked-out' });
    const { _doc, ...view } = f;
    return { ...view, checkedIn: false };
  },
  async todayPresent(societyId: string) {
    return DomesticAttendance.countDocuments({ societyId, date: ymd(), 'entries.0': { $exists: true } });
  },
  async expectedToday(societyId: string) {
    const list: any[] = await DomesticHelp.find({ societyId, status: 'VERIFIED' }).select('name helpType flats.flatLabel').limit(200);
    return list.map((h) => ({ id: String(h._id), name: h.name, helpType: h.helpType, flats: h.flats.map((f: any) => f.flatLabel) }));
  },
};

export const domesticAdminService = createCrudService({ model: DomesticHelp, name: 'Domestic help', searchFields: ['name', 'mobile'], filterable: ['status', 'helpType'], sortable: ['name', 'createdAt'] });
export const providerService = createCrudService({ model: ServiceProvider, name: 'Service provider', searchFields: ['name', 'description'], filterable: ['category', 'verified'], sortable: ['name', 'ratingAvg', 'createdAt'] });

export async function reviewProvider(societyId: string, userId: string, providerId: string, body: { rating: number; comment?: string }) {
  if (!(await ServiceProvider.exists({ _id: providerId, societyId }))) throw ApiError.notFound('Service provider not found');
  const review = await ServiceReview.findOneAndUpdate({ societyId, providerId, userId }, { $set: { rating: body.rating, comment: body.comment }, $setOnInsert: { createdBy: userId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const [agg] = await ServiceReview.aggregate([{ $match: { societyId: oid(societyId), providerId: oid(providerId) } }, { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } }]);
  await ServiceProvider.updateOne({ _id: providerId, societyId }, { $set: { ratingAvg: Math.round((agg?.avg ?? 0) * 10) / 10, ratingCount: agg?.n ?? 0 } });
  return review;
}
export async function reviewHelper(societyId: string, userId: string, flatIds: string[], helpId: string, body: { rating: number; comment?: string }) {
  if (!(await DomesticHelp.exists({ _id: helpId, societyId, 'flats.flatId': { $in: flatIds } }))) throw ApiError.notFound('Helper not assigned to your flat');
  const rows = await ServiceReview.findOneAndUpdate({ societyId, providerId: helpId, userId }, { $set: { rating: body.rating, comment: body.comment }, $setOnInsert: { createdBy: userId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const [agg] = await ServiceReview.aggregate([{ $match: { societyId: oid(societyId), providerId: oid(helpId) } }, { $group: { _id: null, avg: { $avg: '$rating' }, n: { $sum: 1 } } }]);
  await DomesticHelp.updateOne({ _id: helpId, societyId }, { $set: { ratingAvg: Math.round((agg?.avg ?? 0) * 10) / 10, ratingCount: agg?.n ?? 0 } });
  return rows;
}
export const listReviews = (societyId: string, providerId: string, q: any) => paginate(ServiceReview, { societyId, providerId }, q, { sortable: ['createdAt', 'rating'] });
