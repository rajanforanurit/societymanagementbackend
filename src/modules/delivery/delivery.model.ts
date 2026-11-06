import { DeliveryStatus, DeliveryType, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const Delivery = defineModel(
  'Delivery',
  makeSchema(
    {
      gateId: ref('Gate', { index: true }),
      flatId: refReq('Flat', { index: true }),
      flatLabel: String,
      company: { type: String, required: true, trim: true },
      deliveryType: { type: String, enum: vals(DeliveryType), default: 'PARCEL' },
      agentName: { type: String, required: true, trim: true },
      agentMobile: String,
      photoFileId: ref('File'),
      status: { type: String, enum: vals(DeliveryStatus), default: 'PENDING_APPROVAL', index: true },
      leaveAtGate: { type: Boolean, default: false },
      parcelOtpHash: { type: String, select: false },
      parcelReceivedAt: Date,
      collectedAt: Date,
      collectedBy: ref('User'),
      decidedBy: ref('User'),
      decidedAt: Date,
      rejectReason: String,
      entryAt: Date,
      exitAt: Date,
      handledBy: ref('User'),
      note: String,
    },
    { indexes: [[{ societyId: 1, status: 1, createdAt: -1 }], [{ societyId: 1, flatId: 1, createdAt: -1 }]] },
  ),
);
