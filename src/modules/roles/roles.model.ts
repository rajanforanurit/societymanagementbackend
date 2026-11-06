import { model } from 'mongoose';
import { defineModel, makeSchema } from '../../common/models/makeSchema';

export const Role = defineModel(
  'Role',
  makeSchema(
    {
      key: { type: String, required: true, uppercase: true, trim: true },
      name: { type: String, required: true, trim: true },
      description: String,
      permissions: [{ type: String }],
      isSystem: { type: Boolean, default: false },
    },
    { indexes: [[{ societyId: 1, key: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);

export const RoleTemplate = defineModel(
  'RoleTemplate',
  makeSchema(
    {
      key: { type: String, required: true, uppercase: true, trim: true },
      name: { type: String, required: true, trim: true },
      description: String,
      permissions: [{ type: String }],
      isActive: { type: Boolean, default: true },
    },
    { tenant: false, indexes: [[{ key: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);
