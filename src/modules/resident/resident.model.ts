import { model } from 'mongoose';
import { ResidentStatus, ResidentType, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const Resident = defineModel(
  'Resident',
  makeSchema(
    {
      userId: refReq('User', { index: true }),
      flatId: refReq('Flat', { index: true }),
      residentType: { type: String, enum: vals(ResidentType), required: true },
      status: { type: String, enum: vals(ResidentStatus), default: 'PENDING', index: true },
      isPrimary: { type: Boolean, default: false },
      relationToPrimary: String,
      verificationDocs: [{ type: { type: String, required: true }, fileId: refReq('File'), verified: { type: Boolean, default: false } }],
      ownershipVerified: { type: Boolean, default: false },
      tenancy: { startDate: Date, endDate: Date, monthlyRent: Number, landlordName: String },
      moveInDate: Date,
      moveOutDate: Date,
      permissions: {
        canApproveVisitors: { type: Boolean, default: true },
        canPayBills: { type: Boolean, default: true },
        canBookAmenities: { type: Boolean, default: true },
        canRaiseComplaints: { type: Boolean, default: true },
        canListProperties: { type: Boolean, default: true },
      },
      verificationNotes: String,
      rejectionReason: String,
      approvedBy: ref('User'),
      approvedAt: Date,
    },
    {
      indexes: [
        [{ societyId: 1, userId: 1, flatId: 1 }, { unique: true, partialFilterExpression: { isDeleted: false, status: 'APPROVED' } }],
        [{ societyId: 1, flatId: 1, status: 1 }],
        [{ societyId: 1, status: 1, createdAt: -1 }],
      ],
    },
  ),
);

export const FamilyMember = defineModel(
  'FamilyMember',
  makeSchema(
    {
      residentId: refReq('Resident', { index: true }),
      userId: refReq('User', { index: true }),
      flatId: refReq('Flat'),
      name: { type: String, required: true, trim: true },
      relation: { type: String, required: true },
      dateOfBirth: Date,
      mobile: String,
      isMinor: { type: Boolean, default: false },
      canApproveVisitors: { type: Boolean, default: false },
    },
    { indexes: [[{ societyId: 1, flatId: 1 }]] },
  ),
);

export const MoveRequest = defineModel(
  'MoveRequest',
  makeSchema(
    {
      userId: refReq('User', { index: true }),
      residentId: refReq('Resident'),
      flatId: refReq('Flat'),
      type: { type: String, enum: ['MOVE_IN', 'MOVE_OUT'], required: true },
      date: { type: String, required: true },
      notes: String,
      vehicleDetails: String,
      status: { type: String, default: 'DRAFT', index: true },
      rejectionReason: String,
      publishedAt: Date,
    },
    { indexes: [[{ societyId: 1, userId: 1, createdAt: -1 }]] },
  ),
);
