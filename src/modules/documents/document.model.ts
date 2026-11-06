import { DocumentCategory, DocumentScope, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const Document = defineModel(
  'Document',
  makeSchema(
    {
      title: { type: String, required: true, trim: true },
      description: String,
      category: { type: String, enum: vals(DocumentCategory), default: 'OTHER', index: true },
      scope: { type: String, enum: vals(DocumentScope), default: 'SOCIETY', index: true },
      fileId: refReq('File'),
      flatId: ref('Flat', { index: true }),
      ownerUserId: ref('User', { index: true }),
      adminOnly: { type: Boolean, default: false },
    },
    { indexes: [[{ societyId: 1, scope: 1, category: 1, createdAt: -1 }]] },
  ),
);
