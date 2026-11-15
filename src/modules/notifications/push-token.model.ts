import { model } from 'mongoose';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const PushPlatforms = ['ANDROID', 'IOS'] as const;
export type PushPlatform = (typeof PushPlatforms)[number];

/**
 * One row per (device, app install). A user may have several tokens; a token
 * belongs to exactly one user at a time — re-registering a token that moved
 * devices re-points it at the current user.
 */
export const PushToken = defineModel(
  'PushToken',
  makeSchema(
    {
      userId: refReq('User'),
      token: { type: String, required: true, unique: true },
      platform: { type: String, enum: PushPlatforms, required: true },
      deviceId: String,
      deviceName: String,
      appVersion: String,
      lastSeenAt: Date,
    },
    {
      tenant: false,
      softDelete: false,
      audited: false,
      indexes: [[{ userId: 1 }]],
    },
  ),
);
