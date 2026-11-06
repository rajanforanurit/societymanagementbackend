import { Types } from 'mongoose';
import { OtpPurpose, ProfileStatus, ResidentStatus, UserType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { addDays, addMinutes } from '../../common/utils/dates';
import { randomDigits, safeEqual, sha256, uuid } from '../../common/utils/crypto';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../common/utils/jwt';
import { logger } from '../../common/utils/logger';
import { hashPassword, verifyPassword } from '../../common/utils/password';
import { env } from '../../config/env';
import { AdminProfile } from '../admin/admin.model';
import { Guard } from '../guard/guard.model';
import { Resident } from '../resident/resident.model';
import { Society } from '../society/society.model';
import { LoginHistory, Otp, RefreshToken, User } from './auth.model';

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export const normalizeMobile = (m: string) => m.replace(/[\s-]/g, '');

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

async function recordLogin(identifier: string, success: boolean, meta: ClientMeta, extra: { userId?: unknown; reason?: string; method?: string; societyId?: string } = {}) {
  await LoginHistory.create({ identifier, success, ip: meta.ip, userAgent: meta.userAgent, userId: extra.userId, reason: extra.reason, method: extra.method ?? 'PASSWORD', societyId: extra.societyId }).catch(() => undefined);
}

export async function requestOtp(mobile: string, purpose: string) {
  const target = normalizeMobile(mobile);
  const last: any = await Otp.findOne({ target, purpose }).sort({ createdAt: -1 });
  if (last && Date.now() - last.createdAt.getTime() < env.OTP_RESEND_SECONDS * 1000) {
    throw ApiError.tooMany(`Please wait ${env.OTP_RESEND_SECONDS} seconds before requesting another OTP`, 'OTP_RESEND_WAIT');
  }
  if (purpose === OtpPurpose.REGISTER && (await User.exists({ mobile: target }))) throw ApiError.conflict('Mobile number is already registered', 'MOBILE_EXISTS');
  const exists = await User.exists({ mobile: target });
  const code = randomDigits(env.OTP_LENGTH);
  if (purpose === OtpPurpose.REGISTER || exists) {
    await Otp.create({ target, purpose, codeHash: sha256(`${code}:${target}:${purpose}:${env.JWT_ACCESS_SECRET}`), expiresAt: addMinutes(new Date(), env.OTP_TTL_MINUTES) });
    logger.info('otp_issued', { target: `${target.slice(0, 3)}******${target.slice(-2)}`, purpose });
  }
  return {
    message: 'If the number is eligible, an OTP has been sent',
    expiresInSeconds: env.OTP_TTL_MINUTES * 60,
    ...(env.EXPOSE_DEV_OTP && (purpose === OtpPurpose.REGISTER || exists) ? { devOtp: code } : {}),
  };
}

export async function verifyOtp(mobile: string, purpose: string, code: string) {
  const target = normalizeMobile(mobile);
  const otp: any = await Otp.findOne({ target, purpose, consumedAt: null, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
  if (!otp) throw ApiError.badRequest('OTP is invalid or has expired', 'OTP_INVALID');
  if (otp.attempts >= env.OTP_MAX_ATTEMPTS) throw ApiError.tooMany('Too many incorrect attempts. Request a new OTP.', 'OTP_ATTEMPTS_EXCEEDED');
  const expected = sha256(`${code}:${target}:${purpose}:${env.JWT_ACCESS_SECRET}`);
  if (!safeEqual(expected, otp.codeHash)) {
    await Otp.updateOne({ _id: otp._id }, { $inc: { attempts: 1 } });
    throw ApiError.badRequest('OTP is invalid or has expired', 'OTP_INVALID');
  }
  const res = await Otp.updateOne({ _id: otp._id, consumedAt: null }, { $set: { consumedAt: new Date() } });
  if (res.modifiedCount !== 1) throw ApiError.badRequest('OTP is invalid or has expired', 'OTP_INVALID');
}

export async function memberships(user: any) {
  const uid = user._id;
  if (user.userType === UserType.SOCIETY_ADMIN) {
    const profiles: any[] = await AdminProfile.find({ userId: uid }).setOptions({ skipTenantCheck: true }).populate('roleId', 'name');
    const societies: any[] = await Society.find({ _id: { $in: profiles.map((p) => p.societyId) } }).select('name status');
    const map = new Map(societies.map((s) => [String(s._id), s]));
    return profiles
      .filter((p) => map.has(String(p.societyId)))
      .map((p) => ({ societyId: String(p.societyId), societyName: map.get(String(p.societyId)).name, role: UserType.SOCIETY_ADMIN, status: p.status === ProfileStatus.ACTIVE && map.get(String(p.societyId)).status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' }));
  }
  if (user.userType === UserType.GUARD) {
    const guards: any[] = await Guard.find({ userId: uid }).setOptions({ skipTenantCheck: true });
    const societies: any[] = await Society.find({ _id: { $in: guards.map((g) => g.societyId) } }).select('name status');
    const map = new Map(societies.map((s) => [String(s._id), s]));
    return guards
      .filter((g) => map.has(String(g.societyId)))
      .map((g) => ({ societyId: String(g.societyId), societyName: map.get(String(g.societyId)).name, role: UserType.GUARD, status: g.status === ProfileStatus.ACTIVE && map.get(String(g.societyId)).status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' }));
  }
  if (user.userType === UserType.RESIDENT) {
    const residents: any[] = await Resident.find({ userId: uid, status: { $in: [ResidentStatus.APPROVED, ResidentStatus.PENDING] } }).setOptions({ skipTenantCheck: true }).populate('flatId', 'label');
    const societies: any[] = await Society.find({ _id: { $in: residents.map((r) => r.societyId) } }).select('name status');
    const map = new Map(societies.map((s) => [String(s._id), s]));
    const grouped = new Map<string, any>();
    residents.forEach((r) => {
      const sid = String(r.societyId);
      const soc = map.get(sid);
      if (!soc) return;
      const entry = grouped.get(sid) ?? { societyId: sid, societyName: soc.name, role: UserType.RESIDENT, status: 'PENDING', flats: [] };
      if (r.status === ResidentStatus.APPROVED && soc.status === 'ACTIVE') entry.status = 'ACTIVE';
      entry.flats.push({ flatId: String(r.flatId?._id ?? r.flatId), label: r.flatId?.label, residentType: r.residentType, status: r.status });
      grouped.set(sid, entry);
    });
    return [...grouped.values()];
  }
  return [];
}

async function issueSession(user: any, societyId: string | undefined, meta: ClientMeta, familyId?: string) {
  const fresh: any = await User.findById(user._id).select('+tokenVersion');
  const tv = fresh.tokenVersion ?? 0;
  const jti = uuid();
  const fam = familyId ?? uuid();
  const refreshToken = signRefreshToken({ sub: String(user._id), jti, fam, sid: societyId });
  await RefreshToken.create({ userId: user._id, jti, familyId: fam, sid: societyId, expiresAt: addDays(new Date(), env.REFRESH_TOKEN_TTL_DAYS), ip: meta.ip, userAgent: meta.userAgent });
  const accessToken = signAccessToken({ sub: String(user._id), ut: user.userType, tv, sid: societyId });
  return { tokenType: 'Bearer' as const, accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, societyId, passwordChangeRequired: Boolean(user.mustChangePassword), user: user.toJSON(), societies: await memberships(user) };
}

async function pickSociety(user: any, requested?: string) {
  if (user.userType === UserType.SUPER_ADMIN) return undefined;
  const list = await memberships(user);
  const active = list.filter((m) => m.status === 'ACTIVE');
  if (requested) {
    const hit = active.find((m) => m.societyId === requested);
    if (!hit) throw ApiError.forbidden('You do not have active access to the requested society', 'SOCIETY_ACCESS_DENIED');
    return requested;
  }
  if (active.length === 1) return active[0].societyId;
  if (active.length === 0 && user.userType !== UserType.RESIDENT) throw ApiError.forbidden('No active society access for this account', 'NO_ACTIVE_MEMBERSHIP');
  return undefined;
}

export async function register(input: { name: string; mobile: string; email?: string; password: string; otp: string }, meta: ClientMeta) {
  const mobile = normalizeMobile(input.mobile);
  await verifyOtp(mobile, OtpPurpose.REGISTER, input.otp);
  const email = input.email?.toLowerCase();
  if (await User.exists({ mobile })) throw ApiError.conflict('Mobile number is already registered', 'MOBILE_EXISTS');
  if (email && (await User.exists({ email }))) throw ApiError.conflict('Email is already registered', 'EMAIL_EXISTS');
  const user: any = await User.create({ name: input.name, mobile, email, passwordHash: await hashPassword(input.password), userType: UserType.RESIDENT, isMobileVerified: true });
  await recordLogin(mobile, true, meta, { userId: user._id, method: 'OTP' });
  return issueSession(user, undefined, meta);
}

export async function login(input: { identifier: string; password: string; societyId?: string }, meta: ClientMeta) {
  const id = input.identifier.trim();
  const filter = id.includes('@') ? { email: id.toLowerCase() } : { mobile: normalizeMobile(id) };
  const user: any = await User.findOne(filter).select('+passwordHash +failedLoginCount +lockedUntil');
  if (!user) {
    await recordLogin(id, false, meta, { reason: 'UNKNOWN_USER' });
    throw ApiError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await recordLogin(id, false, meta, { userId: user._id, reason: 'LOCKED' });
    throw ApiError.tooMany('Account temporarily locked due to repeated failed logins', 'ACCOUNT_LOCKED');
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    const failed = (user.failedLoginCount ?? 0) + 1;
    await User.updateOne({ _id: user._id }, failed >= MAX_FAILED ? { $set: { failedLoginCount: 0, lockedUntil: addMinutes(new Date(), LOCK_MINUTES) } } : { $set: { failedLoginCount: failed } });
    await recordLogin(id, false, meta, { userId: user._id, reason: 'BAD_PASSWORD' });
    throw ApiError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
  }
  if (!user.isActive) {
    await recordLogin(id, false, meta, { userId: user._id, reason: 'INACTIVE' });
    throw ApiError.forbidden('Account is deactivated', 'ACCOUNT_INACTIVE');
  }
  await User.updateOne({ _id: user._id }, { $set: { failedLoginCount: 0, lastLoginAt: new Date() }, $unset: { lockedUntil: 1 } });
  const societyId = await pickSociety(user, input.societyId);
  await recordLogin(id, true, meta, { userId: user._id, societyId });
  return issueSession(user, societyId, meta);
}

export async function loginWithOtp(input: { mobile: string; otp: string; societyId?: string }, meta: ClientMeta) {
  const mobile = normalizeMobile(input.mobile);
  const user: any = await User.findOne({ mobile });
  if (!user || !user.isActive) throw ApiError.unauthorized('Invalid credentials', 'INVALID_CREDENTIALS');
  await verifyOtp(mobile, OtpPurpose.LOGIN, input.otp);
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date(), isMobileVerified: true } });
  const societyId = await pickSociety(user, input.societyId);
  await recordLogin(mobile, true, meta, { userId: user._id, method: 'OTP', societyId });
  return issueSession(user, societyId, meta);
}

export async function refresh(refreshToken: string, meta: ClientMeta) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token', 'REFRESH_INVALID');
  }
  const stored: any = await RefreshToken.findOne({ jti: payload.jti });
  if (!stored) throw ApiError.unauthorized('Invalid refresh token', 'REFRESH_INVALID');
  if (stored.revokedAt) {
    await RefreshToken.updateMany({ familyId: stored.familyId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    throw ApiError.unauthorized('Refresh token reuse detected. Please sign in again.', 'REFRESH_REUSED');
  }
  const user: any = await User.findById(payload.sub).select('+tokenVersion');
  if (!user || !user.isActive) throw ApiError.unauthorized('Account is inactive', 'ACCOUNT_INACTIVE');
  const claimed = await RefreshToken.updateOne({ jti: payload.jti, revokedAt: null }, { $set: { revokedAt: new Date() } });
  if (claimed.modifiedCount !== 1) throw ApiError.unauthorized('Refresh token already used', 'REFRESH_REUSED');
  let sid = payload.sid;
  if (sid) {
    const list = await memberships(user);
    if (!list.some((m) => m.societyId === sid && m.status === 'ACTIVE')) sid = undefined;
  }
  return issueSession(user, sid, meta, stored.familyId);
}

export async function logout(userId: string, input: { refreshToken?: string; allDevices: boolean }) {
  if (input.allDevices) {
    await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
    await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
    return;
  }
  if (input.refreshToken) {
    try {
      const p = verifyRefreshToken(input.refreshToken);
      if (p.sub === userId) await RefreshToken.updateMany({ familyId: p.fam, revokedAt: null }, { $set: { revokedAt: new Date() } });
    } catch {
      return;
    }
  }
}

export async function switchSociety(userId: string, societyId: string, meta: ClientMeta) {
  const user: any = await User.findById(userId);
  if (!user || user.userType === UserType.SUPER_ADMIN) throw ApiError.forbidden('Society switching is not available for this account', 'FORBIDDEN');
  const sid = await pickSociety(user, societyId);
  return issueSession(user, sid, meta);
}

export async function forgotPassword(mobile: string) {
  return requestOtp(mobile, OtpPurpose.RESET_PASSWORD);
}

export async function resetPassword(input: { mobile: string; otp: string; newPassword: string }) {
  const mobile = normalizeMobile(input.mobile);
  await verifyOtp(mobile, OtpPurpose.RESET_PASSWORD, input.otp);
  const user: any = await User.findOne({ mobile });
  if (!user) throw ApiError.badRequest('OTP is invalid or has expired', 'OTP_INVALID');
  await User.updateOne({ _id: user._id }, { $set: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false, failedLoginCount: 0 }, $unset: { lockedUntil: 1 }, $inc: { tokenVersion: 1 } });
  await RefreshToken.updateMany({ userId: user._id, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function changePassword(userId: string, input: { currentPassword: string; newPassword: string }) {
  const user: any = await User.findById(userId).select('+passwordHash');
  if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) throw ApiError.badRequest('Current password is incorrect', 'INVALID_CURRENT_PASSWORD');
  if (input.currentPassword === input.newPassword) throw ApiError.badRequest('New password must differ from the current password', 'PASSWORD_REUSED');
  await User.updateOne({ _id: userId }, { $set: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false }, $inc: { tokenVersion: 1 } });
  await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

export async function me(auth: { userId: string; societyId?: string; permissions: Set<string>; features: Record<string, boolean> }) {
  const user: any = await User.findById(auth.userId);
  return { user: user.toJSON(), societies: await memberships(user), activeSocietyId: auth.societyId, permissions: [...auth.permissions], features: auth.features };
}

export async function searchSocieties(q: string, limit: number) {
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const list: any[] = await Society.find({ status: 'ACTIVE', $or: [{ name: rx }, { code: rx }, { 'address.city': rx }] }).select('name code address.city').limit(limit);
  return list.map((s) => ({ id: String(s._id), name: s.name, code: s.code, city: s.address?.city }));
}

export const toObjectId = (v: string) => new Types.ObjectId(v);
