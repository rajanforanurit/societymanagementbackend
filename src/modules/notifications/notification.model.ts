import { model } from 'mongoose';
import { NotificationType, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const Notification = defineModel(
  'Notification',
  makeSchema(
    {
      userId: refReq('User'),
      societyId: ref('Society', { index: true }),
      type: { type: String, enum: vals(NotificationType), required: true },
      title: { type: String, required: true },
      body: { type: String, required: true },
      data: Object,
      readAt: Date,
    },
    { tenant: false, audited: false, indexes: [[{ userId: 1, readAt: 1, createdAt: -1 }], [{ userId: 1, societyId: 1, type: 1, createdAt: -1 }], [{ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 }]] },
  ),
);
