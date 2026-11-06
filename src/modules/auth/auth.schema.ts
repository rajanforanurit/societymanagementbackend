import { z } from 'zod';
import { OtpPurpose, ResidentStatus, UserType, vals } from '../../common/constants/enums';
import { globalEntity } from '../../common/responses/schemas';
import { dateTime, email, mobile, objectId, otpCode, password } from '../../common/validators/common';

export const requestOtpBody = z.object({ mobile, purpose: z.enum(vals(OtpPurpose)) });
export const registerBody = z.object({
  name: z.string().trim().min(2).max(120),
  mobile,
  email: email.optional(),
  password,
  otp: otpCode,
});
export const loginBody = z.object({ identifier: z.string().trim().min(3).max(254), password: z.string().min(1).max(72), societyId: objectId.optional() });
export const loginOtpBody = z.object({ mobile, otp: otpCode, societyId: objectId.optional() });
export const refreshBody = z.object({ refreshToken: z.string().min(20) });
export const logoutBody = z.object({ refreshToken: z.string().min(20).optional(), allDevices: z.boolean().default(false) });
export const switchSocietyBody = z.object({ societyId: objectId });
export const forgotPasswordBody = z.object({ mobile });
export const resetPasswordBody = z.object({ mobile, otp: otpCode, newPassword: password });
export const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(72), newPassword: password });
export const societySearchQuery = z.object({ q: z.string().trim().min(2).max(60), limit: z.coerce.number().int().min(1).max(20).default(10) });

export const userProfile = globalEntity({
  name: z.string(),
  mobile: z.string(),
  email: z.string().optional(),
  userType: z.enum(vals(UserType)),
  isActive: z.boolean(),
  isMobileVerified: z.boolean(),
  mustChangePassword: z.boolean(),
  lastLoginAt: dateTime.optional(),
});

export const membership = z.object({
  societyId: objectId,
  societyName: z.string(),
  role: z.enum(vals(UserType)),
  status: z.string(),
  flats: z.array(z.object({ flatId: objectId, label: z.string().optional(), residentType: z.string(), status: z.enum(vals(ResidentStatus)) })).optional(),
});

export const tokenResponse = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  societyId: objectId.optional(),
  passwordChangeRequired: z.boolean(),
  user: userProfile,
  societies: z.array(membership),
});

export const otpResponse = z.object({ message: z.string(), expiresInSeconds: z.number().int(), devOtp: z.string().optional() });
export const meResponse = z.object({ user: userProfile, societies: z.array(membership), activeSocietyId: objectId.optional(), permissions: z.array(z.string()), features: z.record(z.string(), z.boolean()) });
export const societyLookup = z.object({ id: objectId, name: z.string(), code: z.string(), city: z.string().optional() });
