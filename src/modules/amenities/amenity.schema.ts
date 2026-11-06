import { z } from 'zod';
import { AmenityType, BookingStatus, Weekday, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateOnly, dateTime, hhmm, listQuery, money, objectId } from '../../common/validators/common';

export const amenityBody = z.object({
  name: z.string().trim().min(2).max(100),
  type: z.enum(vals(AmenityType)).default('OTHER'),
  description: z.string().max(1000).optional(),
  images: z.array(objectId).max(8).default([]),
  capacity: z.number().int().min(1).max(500).default(1),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  requiresApproval: z.boolean().default(false),
  pricing: z.object({ perSlot: money.default(0), deposit: money.default(0) }).default({ perSlot: 0, deposit: 0 }),
  rules: z.object({ maxActiveBookingsPerFlat: z.number().int().min(1).max(50).default(3), advanceDays: z.number().int().min(1).max(180).default(14), maxGuests: z.number().int().min(0).max(500).optional() }).default({ maxActiveBookingsPerFlat: 3, advanceDays: 14 }),
  operatingHours: z.array(z.object({ day: z.enum(vals(Weekday)), open: hhmm, close: hhmm })).min(1).max(7),
  slotDurationMinutes: z.number().int().refine((v) => [15, 30, 45, 60, 90, 120, 180, 240].includes(v), 'Unsupported slot duration').default(60),
  cancellation: z.object({ freeUntilHours: z.number().int().min(0).max(720).default(24), refundPercentAfter: z.number().min(0).max(100).default(0) }).default({ freeUntilHours: 24, refundPercentAfter: 0 }),
});
export const amenityItem = entity({ name: z.string(), type: z.enum(vals(AmenityType)), description: z.string().optional(), images: z.array(objectId), capacity: z.number().int(), status: z.string(), requiresApproval: z.boolean(), pricing: z.object({ perSlot: z.number(), deposit: z.number() }), rules: z.object({ maxActiveBookingsPerFlat: z.number().int(), advanceDays: z.number().int() }), operatingHours: z.array(z.object({ day: z.string(), open: z.string(), close: z.string() })), slotDurationMinutes: z.number().int(), cancellation: z.object({ freeUntilHours: z.number(), refundPercentAfter: z.number() }), blockedSlots: z.array(z.object({ date: z.string(), startTime: z.string().optional(), endTime: z.string().optional(), reason: z.string().optional() })) });
export const amenityQuery = listQuery.extend({ type: z.enum(vals(AmenityType)).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
export const blockBody = z.object({ date: dateOnly, startTime: hhmm.optional(), endTime: hhmm.optional(), reason: z.string().max(200).optional() });
export const unblockBody = z.object({ date: dateOnly, startTime: hhmm.optional() });
export const slotsQuery = z.object({ date: dateOnly });
export const slotItem = z.object({ startTime: z.string(), endTime: z.string(), capacity: z.number().int(), remaining: z.number().int(), available: z.boolean(), blocked: z.boolean(), price: z.number() });
export const bookBody = z.object({ flatId: objectId.optional(), date: dateOnly, startTime: hhmm, guests: z.number().int().min(0).max(500).default(0) });
export const bookingItem = entity({ amenityId: objectId, flatId: objectId, userId: objectId, date: z.string(), startTime: z.string(), endTime: z.string(), seat: z.number().int(), guests: z.number().int(), status: z.enum(vals(BookingStatus)), amount: z.number(), invoiceId: objectId.optional(), cancelledAt: dateTime.optional(), refundAmount: z.number().optional(), rejectReason: z.string().optional() });
export const bookingQuery = listQuery.extend({ status: z.enum(vals(BookingStatus)).optional(), amenityId: objectId.optional(), date: dateOnly.optional(), flatId: objectId.optional() });
export const cancelBody = z.object({ reason: z.string().max(300).optional() });
export const decideBody = z.object({ reason: z.string().trim().min(3).max(300).optional() });
