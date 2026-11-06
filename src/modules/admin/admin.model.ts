import { model } from 'mongoose';
import { ProfileStatus, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const AdminProfile = defineModel(
  'AdminProfile',
  makeSchema(
    {
      userId: refReq('User', { index: true }),
      roleId: refReq('Role'),
      designation: String,
      extraPermissions: [{ type: String }],
      revokedPermissions: [{ type: String }],
      status: { type: String, enum: vals(ProfileStatus), default: 'ACTIVE', index: true },
      organizationId: ref('Organization'),
    },
    { indexes: [[{ societyId: 1, userId: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);
