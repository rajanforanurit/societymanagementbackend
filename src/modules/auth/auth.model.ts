import { model, Schema } from 'mongoose';
import { OtpPurpose, UserType, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref } from '../../common/models/makeSchema';

export const NOTIFICATION_PREF_KEYS = ['visitor', 'delivery', 'payment', 'complaint', 'marketplace', 'announcement', 'booking', 'chat'] as const;

const prefs = Object.fromEntries(NOTIFICATION_PREF_KEYS.map((k) => [k, { type: Boolean, default: true }]));

export const User = defineModel(
  'User',
  makeSchema(
    {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      email: { type: String, lowercase: true, trim: true },
      mobile: { type: String, required: true, trim: true },
      passwordHash: { type: String, required: true, select: false },
      userType: { type: String, enum: vals(UserType), required: true, index: true },
      isActive: { type: Boolean, default: true, index: true },
      isMobileVerified: { type: Boolean, default: false },
      isEmailVerified: { type: Boolean, default: false },
      mustChangePassword: { type: Boolean, default: false },
      avatarFileId: ref('File'),
      blockedReason: String,
      tokenVersion: { type: Number, default: 0, select: false },
      failedLoginCount: { type: Number, default: 0, select: false },
      lockedUntil: { type: Date, select: false },
      lastLoginAt: Date,
      notificationPrefs: { ...prefs, push: { type: Boolean, default: true }, sms: { type: Boolean, default: true }, email: { type: Boolean, default: true } },
    },
    {
      tenant: false,
      indexes: [
        [{ mobile: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }],
        [{ email: 1 }, { unique: true, partialFilterExpression: { isDeleted: false, email: { $type: 'string' } } }],
        [{ name: 'text', email: 'text', mobile: 'text' }],
      ],
    },
  ),
);

export const Otp = defineModel(
  'Otp',
  makeSchema(
    {
      target: { type: String, required: true, index: true },
      purpose: { type: String, enum: vals(OtpPurpose), required: true },
      codeHash: { type: String, required: true },
      attempts: { type: Number, default: 0 },
      expiresAt: { type: Date, required: true },
      consumedAt: Date,
    },
    { tenant: false, softDelete: false, audited: false, indexes: [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }], [{ target: 1, purpose: 1, createdAt: -1 }]] },
  ),
);

export const RefreshToken = defineModel(
  'RefreshToken',
  makeSchema(
    {
      userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
      jti: { type: String, required: true, unique: true },
      familyId: { type: String, required: true, index: true },
      sid: String,
      expiresAt: { type: Date, required: true },
      revokedAt: Date,
      replacedBy: String,
      ip: String,
      userAgent: String,
    },
    { tenant: false, softDelete: false, audited: false, indexes: [[{ expiresAt: 1 }, { expireAfterSeconds: 0 }]] },
  ),
);

export const LoginHistory = defineModel(
  'LoginHistory',
  makeSchema(
    {
      userId: ref('User', { index: true }),
      identifier: { type: String, required: true },
      success: { type: Boolean, required: true },
      reason: String,
      method: { type: String, enum: ['PASSWORD', 'OTP', 'REFRESH'], default: 'PASSWORD' },
      societyId: ref('Society'),
      ip: String,
      userAgent: String,
    },
    { tenant: false, softDelete: false, audited: false, indexes: [[{ createdAt: 1 }, { expireAfterSeconds: 180 * 86400 }], [{ success: 1, createdAt: -1 }]] },
  ),
);
