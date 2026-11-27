import { NotificationType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { randomDigits } from '../../common/utils/crypto';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { oid } from '../../common/utils/objectId';
import { createCrudService } from '../../common/services/crud.service';
import { normalizeMobile } from '../auth/auth.service';
import { File } from '../files/files.model';
import { realtime } from '../../realtime/socket';
import { notifyAdmins, notifyFlat } from '../notifications/notify.service';
import { Flat, Society } from '../society/society.model';
import { attendanceClock, attendanceDateFilter, calendarDays, firstCheckIns, GateEntry, monthContaining, shiftDate } from './attendance-calendar';
import { DomesticAttendance, DomesticHelp, DomesticPayment, ServiceProvider, ServiceReview } from './domestic.model';

type Res = { flatId: string }[];
const pickFlat = (residents: Res, flatId?: string) => {
  const r = flatId ? residents.find((x) => x.flatId === flatId.toLowerCase()) : residents[0];
  if (!r) throw ApiError.forbidden('You do not belong to this flat', 'FLAT_FORBIDDEN');
  return r.flatId;
};

type GateActor = { societyId: string; userId: string; gateId?: string };
type AttendanceClock = ReturnType<typeof attendanceClock>;

async function societyAttendanceClock(societyId: string) {
  const society: any = await Society.findById(societyId).select('settings.timezone').lean();
  return attendanceClock(society?.settings?.timezone);
}

async function guardHelper(societyId: string, code: string, maidsOnly = false) {
  const help = await DomesticHelp.findOne({ societyId, code, ...(maidsOnly ? { helpType: 'MAID' } : {}) });
  if (!help) throw ApiError.notFound(maidsOnly ? 'No maid found for this code' : 'No domestic help found for this code');
  const pendingAllowed = help.helpType === 'MAID' && help.status === 'PENDING_VERIFICATION' && help.allowPendingGateAttendance;
  if (help.status !== 'VERIFIED' && !pendingAllowed) throw ApiError.forbidden(`Domestic help is ${help.status}; entry not permitted`, 'HELP_NOT_VERIFIED');
  if ((maidsOnly || pendingAllowed) && !help.flats.length) throw ApiError.forbidden('This maid is not assigned to a flat', 'HELP_NOT_ASSIGNED');
  return help;
}

const guardView = (help: any, checkedIn: boolean) => ({
  id: String(help._id), name: help.name, helpType: help.helpType, status: help.status, checkedIn,
  assignedFlats: help.flats.map((flat: any) => ({ flatId: String(flat.flatId), flatLabel: flat.flatLabel })),
});

async function gateEntries(societyId: string, helpId: string, from: string, to = from): Promise<GateEntry[]> {
  const rows = await DomesticAttendance.find({ societyId, helpId, date: attendanceDateFilter(from, to) }).select('entries').lean();
  return rows.flatMap((row) => row.entries ?? []);
}

function gateEntryExists(date: string, timezone: string, onlyOpen: boolean) {
  const sameDate = { $eq: [{ $dateToString: { date: '$$entry.checkInAt', format: '%Y-%m-%d', timezone } }, date] };
  const match = onlyOpen ? { $and: [sameDate, { $eq: [{ $ifNull: ['$$entry.checkOutAt', null] }, null] }] } : sameDate;
  return { $anyElementTrue: [{ $map: { input: { $ifNull: ['$entries', []] }, as: 'entry', in: match } }] };
}

async function appendGateEntry(actor: GateActor, helpId: string, date: string, clock: AttendanceClock, now: Date, oncePerDay: boolean) {
  const key = { societyId: actor.societyId, helpId, date };
  try {
    await DomesticAttendance.updateOne(key, { $setOnInsert: { marks: [], entries: [] } }, { upsert: true });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }
  const result = await DomesticAttendance.updateOne({ ...key, $expr: { $not: [gateEntryExists(date, clock.timezone, !oncePerDay)] } }, {
    $push: { entries: { gateId: actor.gateId, checkInAt: now, markedBy: actor.userId } },
  });
  return result.modifiedCount === 1;
}

async function notifyGateArrival(societyId: string, help: any) {
  if (help.helpType === 'MAID') realtime.toGuards(societyId, 'domestic-help:checked-in', { helpId: String(help._id) });
  await Promise.allSettled(guardView(help, true).assignedFlats.map(({ flatId }: { flatId: string }) => notifyFlat(societyId, flatId, {
    type: NotificationType.VISITOR, title: 'Domestic help arrived', body: `${help.name} has checked in at the gate.`,
    data: { helpId: String(help._id) }, event: 'domestic-help:checked-in',
  })));
}

export const domesticService = {
  async register(societyId: string, userId: string, residents: Res, body: any, allowPendingGateAttendance = false) {
    const flatId = pickFlat(residents, body.flatId);
    const flat: any = await Flat.findOne({ _id: flatId, societyId });
    const mobile = normalizeMobile(body.mobile);
    if (await DomesticHelp.exists({ societyId, mobile })) throw ApiError.conflict('A helper with this mobile number is already registered. Search the directory and hire instead.', 'HELP_EXISTS');
    for (let i = 0; i < 5; i++) {
      try {
        const h = await DomesticHelp.create({ societyId, registeredBy: userId, createdBy: userId, name: body.name, mobile, helpType: body.helpType, photoFileId: body.photoFileId, idProofFileId: body.idProofFileId, code: randomDigits(6), allowPendingGateAttendance, flats: [{ flatId, flatLabel: flat?.label, salaryMonthly: body.salaryMonthly }] });
        await notifyAdmins(societyId, 'domestic-help:manage', { type: NotificationType.APPROVAL, title: 'Domestic help awaiting verification', body: `${body.name} (${body.helpType.toLowerCase()}) registered for ${flat?.label}.`, data: { helpId: String(h._id) } }).catch(() => undefined);
        return h;
      } catch (e: any) {
        if (e?.code !== 11000 || e.keyPattern?.mobile) throw e;
      }
    }
    throw ApiError.conflict('Could not allocate entry code', 'CODE_COLLISION');
  },
  async registerMaid(societyId: string, userId: string, residents: Res, body: { name: string; mobile: string; photoFileId: string; flatId?: string }) {
    const flatId = pickFlat(residents, body.flatId);
    const photo = await File.exists({ _id: body.photoFileId, societyId, uploadedBy: userId, purpose: 'DOMESTIC_HELP', visibility: 'PRIVATE', mimeType: { $in: ['image/jpeg', 'image/png', 'image/webp'] } });
    if (!photo) throw ApiError.badRequest('Upload a valid maid photo before registering', 'MAID_PHOTO_REQUIRED');
    try {
      return await domesticService.register(societyId, userId, residents, { ...body, flatId, helpType: 'MAID' }, true);
    } catch (error) {
      const dbError = error as { code?: number; keyPattern?: { mobile?: number } };
      const duplicateMobile = dbError.code === 11000 && dbError.keyPattern?.mobile;
      if (!duplicateMobile && !(error instanceof ApiError && error.code === 'HELP_EXISTS')) throw error;
      const existing = await DomesticHelp.findOne({ societyId, registeredBy: userId, name: body.name, mobile: normalizeMobile(body.mobile), photoFileId: body.photoFileId, helpType: 'MAID', 'flats.flatId': flatId });
      if (existing) return existing;
      if (duplicateMobile) throw ApiError.conflict('A helper with this mobile number is already registered. Search the directory and hire instead.', 'HELP_EXISTS');
      throw error;
    }
  },
  async mine(societyId: string, flatIds: string[], query: any) {
    const result = await paginate(DomesticHelp, applyListFilters({ societyId, 'flats.flatId': { $in: flatIds.map(oid) } }, query, ['name']), query, { sortable: ['name', 'createdAt'] });
    return { ...result, items: result.items.map((help: any) => ({ ...help.toJSON(), flats: help.flats.filter((flat: any) => flatIds.includes(String(flat.flatId))) })) };
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
  async attendanceCalendar(societyId: string, residents: Res, helpId: string, query: { flatId: string; from?: string; to?: string }) {
    const flatId = pickFlat(residents, query.flatId);
    const help: any = await DomesticHelp.findOne({ _id: helpId, societyId, helpType: 'MAID', 'flats.flatId': flatId }).select('flats createdAt').lean();
    if (!help) throw ApiError.notFound('Maid not assigned to your flat');
    const flat = help.flats.find((assignment: any) => String(assignment.flatId) === flatId);
    const clock = await societyAttendanceClock(societyId);
    const now = new Date();
    const assignedAt: Date = flat.since ?? help.createdAt ?? now;
    const today = clock.dateOf(now);
    const { from, to } = query.from && query.to ? { from: query.from, to: query.to } : monthContaining(today);
    const entries = await gateEntries(societyId, helpId, from, to);
    const firstByDate = firstCheckIns(entries, clock.dateOf, assignedAt);
    return { helpId: String(help._id), flatId, timezone: clock.timezone, today, days: calendarDays(from, to, today, clock.dateOf(assignedAt), firstByDate) };
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
    const help = await guardHelper(societyId, code);
    const clock = await societyAttendanceClock(societyId);
    const date = clock.dateOf(new Date());
    const entries = await gateEntries(societyId, String(help._id), date);
    const open = entries.some((entry) => entry.checkInAt && !entry.checkOutAt && clock.dateOf(entry.checkInAt) === date);
    return { ...guardView(help, open), _doc: help };
  },
  async checkIn(a: GateActor, code: string) {
    const help = await guardHelper(a.societyId, code);
    const helpId = String(help._id);
    const clock = await societyAttendanceClock(a.societyId);
    const now = new Date();
    const date = clock.dateOf(now);
    const entries = await gateEntries(a.societyId, helpId, date);
    const open = entries.some((entry) => entry.checkInAt && !entry.checkOutAt && clock.dateOf(entry.checkInAt) === date);
    if (open || !await appendGateEntry(a, helpId, date, clock, now, false)) throw ApiError.conflict('Already checked in', 'ALREADY_CHECKED_IN');
    await notifyGateArrival(a.societyId, help);
    return guardView(help, true);
  },
  async markMaidAttendance(actor: GateActor, code: string) {
    const { societyId } = actor;
    const help = await guardHelper(societyId, code, true);
    const helpId = String(help._id);
    const clock = await societyAttendanceClock(societyId);
    const now = new Date();
    const date = clock.dateOf(now);
    const firstForToday = async () => firstCheckIns(await gateEntries(societyId, helpId, date), clock.dateOf).get(date);
    let first = await firstForToday();
    let alreadyMarked = true;
    if (!first) {
      alreadyMarked = !await appendGateEntry(actor, helpId, date, clock, now, true);
      first = alreadyMarked ? await firstForToday() : now;
      if (!alreadyMarked) await notifyGateArrival(societyId, help);
    }
    if (!first) throw ApiError.conflict('Attendance changed, please try again', 'ATTENDANCE_CHANGED');
    return { helpId, name: help.name, date, firstCheckInAt: first.toISOString(), alreadyMarked };
  },
  async checkOut(a: { societyId: string; userId: string }, code: string) {
    const help = await guardHelper(a.societyId, code);
    const helpId = String(help._id);
    const clock = await societyAttendanceClock(a.societyId);
    const now = new Date();
    const date = clock.dateOf(now);
    const entries = await gateEntries(a.societyId, helpId, date);
    const open = entries.find((entry) => entry.checkInAt && !entry.checkOutAt && clock.dateOf(entry.checkInAt) === date);
    if (!open?._id) throw ApiError.conflict('Not checked in', 'NOT_CHECKED_IN');
    const r = await DomesticAttendance.updateOne({ societyId: a.societyId, helpId, date: attendanceDateFilter(date), entries: { $elemMatch: { _id: open._id, checkOutAt: null } } }, { $set: { 'entries.$.checkOutAt': now } });
    if (r.modifiedCount !== 1) throw ApiError.conflict('Not checked in', 'NOT_CHECKED_IN');
    const view = guardView(help, false);
    for (const fl of view.assignedFlats) await notifyFlat(a.societyId, fl.flatId, { type: NotificationType.VISITOR, title: 'Domestic help left', body: `${view.name} has checked out.`, data: { helpId }, event: 'domestic-help:checked-out' });
    return view;
  },
  async todayPresent(societyId: string) {
    const clock = await societyAttendanceClock(societyId);
    const date = clock.dateOf(new Date());
    const helpers = await DomesticAttendance.distinct('helpId', { societyId, date: attendanceDateFilter(date), $expr: gateEntryExists(date, clock.timezone, false) });
    return helpers.length;
  },
  async expectedToday(societyId: string) {
    const list: any[] = await DomesticHelp.find({ societyId, status: 'VERIFIED' }).select('name helpType flats.flatLabel').limit(200);
    return list.map((h) => ({ id: String(h._id), name: h.name, helpType: h.helpType, flats: h.flats.map((f: any) => f.flatLabel) }));
  },
  async recentMaidActivity(societyId: string) {
    const { timezone, dateOf } = await societyAttendanceClock(societyId);
    const since = shiftDate(dateOf(new Date()), -30);
    const tenant = oid(societyId);
    const rows = await DomesticAttendance.aggregate([
      { $match: { societyId: tenant, date: { $gte: shiftDate(since, -1) }, 'entries.checkInAt': { $exists: true } } },
      { $project: { helpId: 1, checkIn: '$entries.checkInAt' } },
      { $unwind: '$checkIn' },
      { $match: { checkIn: { $type: 'date' } } },
      { $group: { _id: { helpId: '$helpId', date: { $dateToString: { date: '$checkIn', format: '%Y-%m-%d', timezone } } }, at: { $min: '$checkIn' } } },
      { $match: { '_id.date': { $gte: since } } },
      { $sort: { at: -1, '_id.helpId': 1 } },
      { $lookup: {
        from: DomesticHelp.collection.name, localField: '_id.helpId', foreignField: '_id', as: 'maid',
        pipeline: [{ $match: { societyId: tenant, helpType: 'MAID', isDeleted: { $ne: true } } }, { $project: { name: 1 } }],
      } },
      { $unwind: '$maid' },
      { $limit: 25 },
    ]);
    return rows.map((row) => ({ id: `${row._id.helpId}:${row._id.date}`, kind: 'MAID_ATTENDANCE' as const, name: row.maid.name as string, status: 'PRESENT', at: row.at as Date }));
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
