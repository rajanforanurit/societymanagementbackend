import { model } from 'mongoose';
import { FilePurpose, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, refReq } from '../../common/models/makeSchema';

export const File = defineModel(
  'File',
  makeSchema(
    {
      uploadedBy: refReq('User', { index: true }),
      originalName: { type: String, required: true },
      mimeType: { type: String, required: true },
      size: { type: Number, required: true },
      storageName: { type: String, required: true, select: false },
      checksum: String,
      purpose: { type: String, enum: vals(FilePurpose), default: 'OTHER' },
      visibility: { type: String, enum: ['PRIVATE', 'SOCIETY'], default: 'PRIVATE' },
    },
    { indexes: [[{ societyId: 1, uploadedBy: 1, createdAt: -1 }]] },
  ),
);
