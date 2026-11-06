import { Schema } from 'mongoose';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';
import { ApprovalEntityType, ApprovalStatus, vals } from '../../common/constants/enums';

export const ApprovalRequest = defineModel(
  'ApprovalRequest',
  makeSchema(
    {
      entityType: { type: String, enum: vals(ApprovalEntityType), required: true },
      entityId: { type: Schema.Types.ObjectId, required: true, index: true },
      title: { type: String, required: true },
      summary: String,
      status: { type: String, enum: vals(ApprovalStatus), required: true, index: true },
      submittedBy: refReq('User'),
      reviewerId: ref('User'),
      submittedAt: Date,
      decidedAt: Date,
      version: { type: Number, default: 1 },
      history: [
        {
          from: String,
          to: { type: String, required: true },
          by: ref('User'),
          byRole: String,
          reason: String,
          at: { type: Date, default: Date.now },
        },
      ],
    },
    { indexes: [[{ societyId: 1, entityType: 1, entityId: 1 }, { unique: true }], [{ societyId: 1, status: 1, entityType: 1, createdAt: -1 }]] },
  ),
);
