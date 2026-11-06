import { model } from 'mongoose';
import { ProfileStatus, Shift, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const Guard = defineModel(
  'Guard',
  makeSchema(
    {
      userId: refReq('User', { index: true }),
      gateId: refReq('Gate', { index: true }),
      employeeCode: { type: String, trim: true },
      agency: String,
      shift: { type: String, enum: vals(Shift), default: 'GENERAL' },
      status: { type: String, enum: vals(ProfileStatus), default: 'ACTIVE', index: true },
      joinedAt: Date,
      photoFileId: ref('File'),
    },
    { indexes: [[{ societyId: 1, userId: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);
