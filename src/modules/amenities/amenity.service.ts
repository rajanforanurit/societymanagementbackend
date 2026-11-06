import { ApiError } from '../../common/utils/apiError';
import { createCrudService } from '../../common/services/crud.service';
import { addDays, hhmmOf, minutesOf, weekdayOf, ymd } from '../../common/utils/dates';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { NotificationType } from '../../common/constants/enums';
import { notifyAdmins, notifyUsers } from '../notifications/notify.service';
import { Flat, Society } from '../society/society.model';
import { Invoice } from '../payments/payment.model';
import { createAmenityInvoice, round2 } from '../payments/payment.service';
import { Amenity, AmenityBooking } from './amenity.model';

export const amenityService = createCrudService({ model: Amenity, name: 'Amenity', searchFields: ['name'], filterable: ['type', 'status'], sortable: ['name', 'createdAt'], defaultSort: 'name' });

const ACTIVE = ['PENDING', 'CONFIRMED'];

export function buildSlots(a: any, date: string) {
  const hours = a.operatingHours.find((h: any) => h.day === weekdayOf(date));
  if (!hours) return [];
  const slots: { startTime: string; endTime: string }[] = [];
  const dur = a.slotDurationMinutes;
  for (let t = minutesOf(hours.open); t + dur <= minutesOf(hours.close); t += dur) slots.push({ startTime: hhmmOf(t), endTime: hhmmOf(t + dur) });
  return slots;
}

const isBlocked = (a: any, date: string, s: { startTime: string; endTime: string }) =>
  a.blockedSlots.some((b: any) => b.date === date && (!b.startTime || (minutesOf(b.startTime) < minutesOf(s.endTime) && minutesOf(b.endTime ?? '23:59') > minutesOf(s.startTime))));

const loadAmenity = async (societyId: string, id: string, activeOnly = true) => {
  const a: any = await Amenity.findOne({ _id: id, societyId, ...(activeOnly ? { status: 'ACTIVE' } : {}) });
  if (!a) throw ApiError.notFound('Amenity not found');
  return a;
};

export const amenityExtra = {
  async block(societyId: string, userId: string, id: string, body: any) {
    const a = await Amenity.findOneAndUpdate({ _id: id, societyId }, { $push: { blockedSlots: body }, $set: { updatedBy: userId } }, { new: true });
    if (!a) throw ApiError.notFound('Amenity not found');
    return a;
  },
  async unblock(societyId: string, userId: string, id: string, body: any) {
    const a = await Amenity.findOneAndUpdate({ _id: id, societyId }, { $pull: { blockedSlots: { date: body.date, ...(body.startTime ? { startTime: body.startTime } : {}) } }, $set: { updatedBy: userId } }, { new: true });
    if (!a) throw ApiError.notFound('Amenity not found');
    return a;
  },
  async slots(societyId: string, id: string, date: string) {
    const a = await loadAmenity(societyId, id);
    const taken: any[] = await AmenityBooking.aggregate([{ $match: { societyId: a.societyId, amenityId: a._id, date, isActive: true } }, { $group: { _id: '$startTime', n: { $sum: 1 } } }]);
    const now = new Date();
    return buildSlots(a, date).map((s) => {
      const blocked = isBlocked(a, date, s);
      const past = new Date(`${date}T${s.startTime}:00.000Z`) < now;
      const remaining = Math.max(0, a.capacity - (taken.find((t) => t._id === s.startTime)?.n ?? 0));
      return { ...s, capacity: a.capacity, remaining, blocked, available: !blocked && !past && remaining > 0, price: a.pricing.perSlot };
    });
  },
  async book(societyId: string, userId: string, residents: { flatId: string; permissions: Record<string, boolean> }[], id: string, body: any) {
    const a = await loadAmenity(societyId, id);
    const res = body.flatId ? residents.find((r) => r.flatId === body.flatId) : residents[0];
    if (!res) throw ApiError.forbidden('You do not belong to this flat', 'FLAT_FORBIDDEN');
    if (res.permissions.canBookAmenities === false) throw ApiError.forbidden('You are not permitted to book amenities', 'RESIDENT_PERMISSION_DENIED');
    const slot = buildSlots(a, body.date).find((s) => s.startTime === body.startTime);
    if (!slot) throw ApiError.badRequest('No such slot on this date', 'INVALID_SLOT');
    if (isBlocked(a, body.date, slot)) throw ApiError.conflict('This slot is blocked', 'SLOT_BLOCKED');
    if (new Date(`${body.date}T${slot.startTime}:00.000Z`) < new Date()) throw ApiError.badRequest('Slot is in the past', 'SLOT_IN_PAST');
    if (body.date > ymd(addDays(new Date(), a.rules.advanceDays))) throw ApiError.badRequest(`Bookings open ${a.rules.advanceDays} days in advance`, 'TOO_FAR_AHEAD');
    if (a.rules.maxGuests !== undefined && body.guests > a.rules.maxGuests) throw ApiError.badRequest('Too many guests', 'TOO_MANY_GUESTS');
    const society: any = await Society.findById(societyId).select('settings.holidays');
    if (society?.settings?.holidays?.some((h: any) => h.date === body.date && a.type === 'OTHER')) throw ApiError.conflict('Society holiday', 'HOLIDAY');
    const open = await AmenityBooking.countDocuments({ societyId, amenityId: id, flatId: res.flatId, isActive: true, date: { $gte: ymd() } });
    if (open >= a.rules.maxActiveBookingsPerFlat) throw ApiError.conflict('Booking limit reached for your flat', 'BOOKING_LIMIT');
    const flat: any = await Flat.findOne({ _id: res.flatId, societyId });
    const status = a.requiresApproval ? 'PENDING' : 'CONFIRMED';
    const amount = round2(a.pricing.perSlot);
    for (let seat = 1; seat <= a.capacity; seat++) {
      try {
        const [b]: any[] = await AmenityBooking.create([{ societyId, amenityId: id, flatId: res.flatId, userId, date: body.date, startTime: slot.startTime, endTime: slot.endTime, seat, guests: body.guests, status, amount, createdBy: userId }]);
        if (amount > 0) {
          const inv: any = await createAmenityInvoice(societyId, userId, res.flatId, flat?.label, `${a.name} booking ${body.date} ${slot.startTime}`, amount, String(b._id));
          await AmenityBooking.updateOne({ _id: b._id, societyId }, { $set: { invoiceId: inv._id } });
          b.invoiceId = inv._id;
        }
        if (a.requiresApproval) await notifyAdmins(societyId, 'booking:manage', { type: NotificationType.BOOKING, title: 'Booking awaiting approval', body: `${a.name} on ${body.date} ${slot.startTime}`, data: { bookingId: String(b._id) }, event: 'booking:requested' });
        return b;
      } catch (e: any) {
        if (e?.code !== 11000) throw e;
      }
    }
    throw ApiError.conflict('Slot is fully booked', 'SLOT_FULL');
  },
  async cancel(societyId: string, a: { userId: string; flatIds?: string[]; admin?: boolean }, id: string, reason?: string) {
    const b: any = await AmenityBooking.findOne({ _id: id, societyId, isActive: true, ...(a.admin ? {} : { $or: [{ userId: a.userId }, { flatId: { $in: a.flatIds ?? [] } }] }) });
    if (!b) throw ApiError.notFound('Active booking not found');
    const am: any = await Amenity.findOne({ _id: b.amenityId, societyId });
    const start = new Date(`${b.date}T${b.startTime}:00.000Z`);
    const hoursLeft = (start.getTime() - Date.now()) / 3600000;
    const free = a.admin || hoursLeft >= (am?.cancellation?.freeUntilHours ?? 24);
    const refund = b.amount > 0 ? round2(free ? b.amount : (b.amount * (am?.cancellation?.refundPercentAfter ?? 0)) / 100) : 0;
    const r = await AmenityBooking.findOneAndUpdate({ _id: id, societyId, isActive: true }, { $set: { status: 'CANCELLED', isActive: false, cancelledAt: new Date(), cancelReason: reason, refundAmount: refund } }, { new: true });
    if (!r) throw ApiError.conflict('Booking already changed', 'CONCURRENT_UPDATE');
    if (b.invoiceId) await Invoice.updateOne({ _id: b.invoiceId, societyId, paidAmount: 0, status: { $in: ['UNPAID', 'OVERDUE'] } }, { $set: { status: 'CANCELLED', balance: 0 } });
    if (a.admin) await notifyUsers({ societyId, userIds: [b.userId], type: NotificationType.BOOKING, title: 'Booking cancelled', body: reason ?? 'Your booking was cancelled by management.', data: { bookingId: id } });
    return r;
  },
  async decide(societyId: string, userId: string, id: string, approve: boolean, reason?: string) {
    if (!approve && !reason) throw ApiError.badRequest('A reason is required', 'REASON_REQUIRED');
    const b: any = await AmenityBooking.findOneAndUpdate({ _id: id, societyId, status: 'PENDING' }, { $set: approve ? { status: 'CONFIRMED', decidedBy: userId } : { status: 'REJECTED', isActive: false, decidedBy: userId, rejectReason: reason } }, { new: true });
    if (!b) throw ApiError.conflict('Only pending bookings can be decided', 'INVALID_STATE');
    if (!approve && b.invoiceId) await Invoice.updateOne({ _id: b.invoiceId, societyId, paidAmount: 0 }, { $set: { status: 'CANCELLED', balance: 0 } });
    await notifyUsers({ societyId, userIds: [b.userId], type: NotificationType.BOOKING, title: approve ? 'Booking confirmed' : 'Booking rejected', body: approve ? `${b.date} ${b.startTime}` : (reason as string), data: { bookingId: id }, event: 'booking:decided' });
    return b;
  },
  async list(societyId: string, q: any, scope: Record<string, unknown> = {}) {
    const f: Record<string, unknown> = { societyId, ...scope };
    ['status', 'amenityId', 'date', 'flatId'].forEach((k) => q[k] && (f[k] = q[k]));
    return paginate(AmenityBooking, applyListFilters(f, q), q, { sortable: ['date', 'createdAt', 'startTime'], defaultSort: '-date' });
  },
  async completePast() {
    const today = ymd();
    await AmenityBooking.updateMany({ status: 'CONFIRMED', isActive: true, date: { $lt: today } }, { $set: { status: 'COMPLETED' } }).setOptions({ skipTenantCheck: true });
  },
  async sendReminders() {
    const tomorrow = ymd(addDays(new Date(), 1));
    const list: any[] = await AmenityBooking.find({ status: 'CONFIRMED', isActive: true, date: tomorrow, reminderSentAt: null }).setOptions({ skipTenantCheck: true }).limit(500);
    for (const b of list) {
      await AmenityBooking.updateOne({ _id: b._id, societyId: b.societyId }, { $set: { reminderSentAt: new Date() } });
      await notifyUsers({ societyId: String(b.societyId), userIds: [b.userId], type: NotificationType.BOOKING, title: 'Booking reminder', body: `You have a booking tomorrow at ${b.startTime}.`, data: { bookingId: String(b._id) }, event: 'booking:reminder' });
    }
  },
  loadAmenity,
};
