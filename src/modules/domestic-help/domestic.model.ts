import { AttendanceStatus, DomesticHelpStatus, DomesticHelpType, HelpPaymentType, ServiceCategory, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const DomesticHelp = defineModel(
  'DomesticHelp',
  makeSchema(
    {
      registeredBy: refReq('User', { index: true }),
      name: { type: String, required: true, trim: true },
      mobile: { type: String, required: true, trim: true },
      helpType: { type: String, enum: vals(DomesticHelpType), required: true, index: true },
      photoFileId: ref('File'),
      idProofFileId: ref('File'),
      status: { type: String, enum: vals(DomesticHelpStatus), default: 'PENDING_VERIFICATION', index: true },
      verifiedBy: ref('User'),
      verifiedAt: Date,
      rejectionReason: String,
      code: { type: String, required: true },
      flats: [{ flatId: refReq('Flat'), flatLabel: String, since: { type: Date, default: Date.now }, salaryMonthly: Number }],
      ratingAvg: { type: Number, default: 0 },
      ratingCount: { type: Number, default: 0 },
    },
    { indexes: [[{ societyId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }], [{ societyId: 1, mobile: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }], [{ societyId: 1, 'flats.flatId': 1 }]] },
  ),
);

export const DomesticAttendance = defineModel(
  'DomesticAttendance',
  makeSchema(
    {
      helpId: refReq('DomesticHelp', { index: true }),
      date: { type: String, required: true },
      entries: [{ gateId: ref('Gate'), checkInAt: Date, checkOutAt: Date, markedBy: ref('User') }],
      marks: [{ flatId: refReq('Flat'), status: { type: String, enum: vals(AttendanceStatus) }, note: String, markedBy: ref('User'), at: { type: Date, default: Date.now } }],
    },
    { audited: false, indexes: [[{ societyId: 1, helpId: 1, date: 1 }, { unique: true }], [{ societyId: 1, date: 1 }]] },
  ),
);

export const DomesticPayment = defineModel(
  'DomesticPayment',
  makeSchema(
    {
      helpId: refReq('DomesticHelp', { index: true }),
      flatId: refReq('Flat'),
      type: { type: String, enum: vals(HelpPaymentType), required: true },
      amount: { type: Number, required: true, min: 0 },
      month: String,
      paidOn: { type: String, required: true },
      note: String,
    },
    { indexes: [[{ societyId: 1, flatId: 1, helpId: 1, paidOn: -1 }]] },
  ),
);

export const ServiceProvider = defineModel(
  'ServiceProvider',
  makeSchema(
    {
      name: { type: String, required: true, trim: true },
      category: { type: String, enum: vals(ServiceCategory), required: true, index: true },
      mobile: { type: String, required: true },
      description: String,
      verified: { type: Boolean, default: false },
      status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
      ratingAvg: { type: Number, default: 0 },
      ratingCount: { type: Number, default: 0 },
      documents: [{ type: { type: String }, fileId: ref('File'), verified: { type: Boolean, default: false } }],
    },
    { indexes: [[{ societyId: 1, category: 1, status: 1 }]] },
  ),
);

export const ServiceReview = defineModel(
  'ServiceReview',
  makeSchema(
    { providerId: refReq('ServiceProvider', { index: true }), userId: refReq('User'), rating: { type: Number, min: 1, max: 5, required: true }, comment: String },
    { audited: false, indexes: [[{ societyId: 1, providerId: 1, userId: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);
