import { model } from 'mongoose';
import {
  FEATURE_KEYS, FeeType, FlatStatus, Priority, Shift, SocietyStatus, SocietyType, TimeoutAction, VisitorType, Weekday, vals,
} from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

const flags = (def: boolean) => Object.fromEntries(FEATURE_KEYS.map((k) => [k, { type: Boolean, default: def }]));
const approvalRequired = Object.fromEntries(vals(VisitorType).map((k) => [k, { type: Boolean, default: true }]));

export const Society = defineModel(
  'Society',
  makeSchema(
    {
      name: { type: String, required: true, trim: true, maxlength: 200 },
      code: { type: String, required: true, trim: true, uppercase: true },
      organizationId: ref('Organization', { index: true }),
      type: { type: String, enum: vals(SocietyType), default: 'APARTMENT' },
      status: { type: String, enum: vals(SocietyStatus), default: 'PENDING', index: true },
      address: { line1: String, line2: String, city: String, state: String, country: { type: String, default: 'India' }, pincode: String, latitude: Number, longitude: Number },
      contact: { email: String, phone: String, emergencyPhone: String, website: String },
      registrationNumber: String,
      totalUnits: Number,
      logoFileId: ref('File'),
      planId: ref('SubscriptionPlan'),
      subscription: { status: { type: String, enum: ['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED'], default: 'TRIAL' }, startsAt: Date, endsAt: Date },
      features: flags(true),
      settings: {
        modules: flags(true),
        timezone: { type: String, default: 'Asia/Kolkata' },
        currency: { type: String, default: 'INR' },
        rules: [{ title: { type: String, required: true }, body: { type: String, required: true } }],
        operatingHours: [{ day: { type: String, enum: vals(Weekday) }, open: String, close: String, closed: { type: Boolean, default: false } }],
        holidays: [{ date: { type: String, required: true }, name: { type: String, required: true } }],
        visitorPolicy: {
          approvalRequired,
          deliveryApprovalRequired: { type: Boolean, default: true },
          approvalTimeoutSeconds: { type: Number, default: 120 },
          onTimeout: { type: String, enum: vals(TimeoutAction), default: 'DENY' },
          allowPreApproved: { type: Boolean, default: true },
          requirePhoto: { type: Boolean, default: false },
          allowEmergencyEntry: { type: Boolean, default: true },
          overstayMinutes: { type: Number, default: 240 },
        },
        finance: {
          dueDays: { type: Number, default: 10 },
          invoicePrefix: { type: String, default: 'INV' },
          lateFee: { type: { type: String, enum: vals(FeeType), default: 'FIXED' }, value: { type: Number, default: 0 }, graceDays: { type: Number, default: 0 } },
        },
        listing: { expiryDays: { type: Number, default: 30 }, autoPublish: { type: Boolean, default: true }, reportSuspendThreshold: { type: Number, default: 3 } },
        complaint: {
          slaHours: {
            LOW: { type: Number, default: 72 },
            MEDIUM: { type: Number, default: 48 },
            HIGH: { type: Number, default: 24 },
            CRITICAL: { type: Number, default: 4 },
          },
        },
      },
      applicant: { name: String, email: String, mobile: String, notes: String },
      approvedAt: Date,
      approvedBy: ref('User'),
      statusReason: String,
    },
    { tenant: false, indexes: [[{ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }], [{ name: 'text', code: 'text', 'address.city': 'text' }], [{ organizationId: 1, status: 1 }]] },
  ),
);

export const Block = defineModel(
  'Block',
  makeSchema({ name: { type: String, required: true, trim: true }, description: String, status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' } }, {
    indexes: [[{ societyId: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]],
  }),
);

export const Tower = defineModel(
  'Tower',
  makeSchema(
    { name: { type: String, required: true, trim: true }, blockId: ref('Block'), totalFloors: Number, hasLift: { type: Boolean, default: true }, status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' } },
    { indexes: [[{ societyId: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);

export const Floor = defineModel(
  'Floor',
  makeSchema(
    { towerId: refReq('Tower'), number: { type: Number, required: true }, label: String },
    { indexes: [[{ societyId: 1, towerId: 1, number: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);

export const Flat = defineModel(
  'Flat',
  makeSchema(
    {
      label: { type: String, required: true, trim: true },
      towerId: ref('Tower', { index: true }),
      blockId: ref('Block'),
      floorId: ref('Floor'),
      floorNumber: Number,
      unitNumber: { type: String, required: true },
      unitType: { type: String, default: '2BHK' },
      areaSqft: Number,
      status: { type: String, enum: vals(FlatStatus), default: 'VACANT', index: true },
      ownerResidentId: ref('Resident'),
      parkingSlots: { type: Number, default: 0 },
      deliveryPreference: { leaveAtGate: { type: Boolean, default: false }, autoApprove: { type: Boolean, default: false } },
    },
    { indexes: [[{ societyId: 1, label: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }], [{ societyId: 1, towerId: 1, floorNumber: 1 }]] },
  ),
);

export const Gate = defineModel(
  'Gate',
  makeSchema(
    {
      name: { type: String, required: true, trim: true },
      type: { type: String, enum: ['MAIN', 'SERVICE', 'VISITOR', 'DELIVERY', 'EMERGENCY'], default: 'MAIN' },
      location: String,
      shifts: [{ type: String, enum: vals(Shift) }],
      isActive: { type: Boolean, default: true },
    },
    { indexes: [[{ societyId: 1, name: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);

export const PRIORITIES = vals(Priority);
