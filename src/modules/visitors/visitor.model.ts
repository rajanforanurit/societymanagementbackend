import { ApprovalMode, InvitationStatus, VisitorStatus, VisitorType, Weekday, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const Visitor = defineModel(
  'Visitor',
  makeSchema(
    {
      gateId: ref('Gate', { index: true }),
      flatId: refReq('Flat', { index: true }),
      flatLabel: String,
      visitorType: { type: String, enum: vals(VisitorType), default: 'GUEST' },
      name: { type: String, required: true, trim: true, maxlength: 120 },
      mobile: { type: String, trim: true },
      vehicleNumber: { type: String, uppercase: true, trim: true },
      purpose: String,
      company: String,
      photoFileId: ref('File'),
      status: { type: String, enum: vals(VisitorStatus), default: 'PENDING_APPROVAL', index: true },
      approvalMode: { type: String, enum: vals(ApprovalMode) },
      invitationId: ref('VisitorInvitation'),
      requestedAt: { type: Date, default: Date.now },
      decidedAt: Date,
      decidedBy: ref('User'),
      rejectReason: String,
      entryAt: Date,
      exitAt: Date,
      enteredBy: ref('User'),
      exitedBy: ref('User'),
      isEmergencyEntry: { type: Boolean, default: false },
      emergencyReason: String,
      overstayNotifiedAt: Date,
    },
    { indexes: [[{ societyId: 1, status: 1, createdAt: -1 }], [{ societyId: 1, flatId: 1, createdAt: -1 }], [{ societyId: 1, mobile: 1 }], [{ societyId: 1, status: 1, entryAt: 1 }]] },
  ),
);

export const VisitorInvitation = defineModel(
  'VisitorInvitation',
  makeSchema(
    {
      flatId: refReq('Flat', { index: true }),
      flatLabel: String,
      visitorName: { type: String, required: true, trim: true },
      visitorMobile: { type: String, trim: true },
      visitorType: { type: String, enum: vals(VisitorType), default: 'GUEST' },
      purpose: String,
      vehicleNumber: { type: String, uppercase: true, trim: true },
      validFrom: { type: Date, required: true },
      validTo: { type: Date, required: true },
      recurring: { enabled: { type: Boolean, default: false }, days: [{ type: String, enum: vals(Weekday) }], timeFrom: String, timeTo: String },
      maxEntries: { type: Number, default: 1 },
      usedEntries: { type: Number, default: 0 },
      code: { type: String, required: true },
      status: { type: String, enum: vals(InvitationStatus), default: 'ACTIVE', index: true },
    },
    { indexes: [[{ societyId: 1, code: 1 }, { unique: true, partialFilterExpression: { status: 'ACTIVE' } }], [{ societyId: 1, flatId: 1, status: 1, validTo: 1 }]] },
  ),
);
