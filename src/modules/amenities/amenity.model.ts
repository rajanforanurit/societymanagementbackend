import { AmenityType, BookingStatus, Weekday, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const Amenity = defineModel(
  'Amenity',
  makeSchema(
    {
      name: { type: String, required: true, trim: true },
      type: { type: String, enum: vals(AmenityType), default: 'OTHER' },
      description: String,
      images: [ref('File')],
      capacity: { type: Number, default: 1, min: 1 },
      status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
      requiresApproval: { type: Boolean, default: false },
      pricing: { perSlot: { type: Number, default: 0 }, deposit: { type: Number, default: 0 } },
      rules: { maxActiveBookingsPerFlat: { type: Number, default: 3 }, advanceDays: { type: Number, default: 14 }, maxGuests: Number },
      operatingHours: [{ day: { type: String, enum: vals(Weekday) }, open: String, close: String }],
      slotDurationMinutes: { type: Number, default: 60 },
      cancellation: { freeUntilHours: { type: Number, default: 24 }, refundPercentAfter: { type: Number, default: 0 } },
      blockedSlots: [{ date: { type: String, required: true }, startTime: String, endTime: String, reason: String }],
    },
    { indexes: [[{ societyId: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);

export const AmenityBooking = defineModel(
  'AmenityBooking',
  makeSchema(
    {
      amenityId: refReq('Amenity', { index: true }),
      flatId: refReq('Flat', { index: true }),
      userId: refReq('User', { index: true }),
      date: { type: String, required: true },
      startTime: { type: String, required: true },
      endTime: { type: String, required: true },
      seat: { type: Number, default: 1 },
      guests: { type: Number, default: 0 },
      status: { type: String, enum: vals(BookingStatus), default: 'CONFIRMED', index: true },
      isActive: { type: Boolean, default: true },
      amount: { type: Number, default: 0 },
      invoiceId: ref('Invoice'),
      cancelledAt: Date,
      cancelReason: String,
      refundAmount: Number,
      decidedBy: ref('User'),
      rejectReason: String,
      reminderSentAt: Date,
    },
    { indexes: [[{ societyId: 1, amenityId: 1, date: 1, startTime: 1, seat: 1 }, { unique: true, partialFilterExpression: { isActive: true } }], [{ societyId: 1, userId: 1, date: -1 }], [{ societyId: 1, status: 1, date: 1 }]] },
  ),
);
