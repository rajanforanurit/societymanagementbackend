import { NextFunction, Request, Response } from 'express';
import { ALL_PERMISSIONS, computePermissions } from '../common/constants/permissions';
import { FEATURE_KEYS, ProfileStatus, ResidentStatus, UserType } from '../common/constants/enums';
import { AuthContext } from '../common/types';
import { ApiError } from '../common/utils/apiError';
import { verifyAccessToken } from '../common/utils/jwt';
import { AdminProfile } from '../modules/admin/admin.model';
import { User } from '../modules/auth/auth.model';
import { Guard } from '../modules/guard/guard.model';
import { Resident } from '../modules/resident/resident.model';
import { Society } from '../modules/society/society.model';
import { ImpersonationSession } from '../modules/super-admin/super-admin.model';

export const effectiveFeatures = (society: any) => {
  const out: Record<string, boolean> = {};
  FEATURE_KEYS.forEach((k) => {
    out[k] = society?.features?.[k] !== false && society?.settings?.modules?.[k] !== false;
  });
  return out;
};

export async function buildAuthContext(token: string): Promise<AuthContext> {
  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw ApiError.unauthorized('Invalid or expired access token', 'TOKEN_INVALID');
  }
  const user = await User.findOne({ _id: payload.sub }).select('+tokenVersion');
  if (!user || !user.isActive) throw ApiError.unauthorized('Account is inactive or no longer exists', 'ACCOUNT_INACTIVE');
  if (user.tokenVersion !== payload.tv) throw ApiError.unauthorized('Session has been revoked', 'TOKEN_REVOKED');

  const ctx: AuthContext = {
    userId: String(user._id),
    userType: user.userType,
    role: user.userType,
    societyId: user.userType === UserType.SUPER_ADMIN && !payload.imp ? undefined : payload.sid,
    permissions: new Set<string>(),
    features: {},
    residents: [],
    flatIds: [],
  };

  if (payload.imp) {
    if (user.userType !== UserType.SUPER_ADMIN || !payload.sid) throw ApiError.unauthorized('Invalid impersonation token', 'TOKEN_INVALID');
    const session = await ImpersonationSession.findOne({ _id: payload.imp, superAdminId: user._id, societyId: payload.sid, endedAt: null, expiresAt: { $gt: new Date() } });
    if (!session) throw ApiError.unauthorized('Impersonation session ended or expired', 'IMPERSONATION_ENDED');
    ctx.role = UserType.SOCIETY_ADMIN;
    ctx.impersonationId = String(session._id);
    ctx.permissions = new Set<string>(ALL_PERMISSIONS);
  }

  if (ctx.societyId) {
    const society = await Society.findById(ctx.societyId).select('name status features settings.modules');
    if (!society) throw ApiError.forbidden('Society not found', 'SOCIETY_NOT_FOUND');
    if (society.status !== 'ACTIVE' && ctx.role !== UserType.SUPER_ADMIN && !ctx.impersonationId) {
      throw ApiError.forbidden('This society is not active', 'SOCIETY_INACTIVE');
    }
    ctx.societyName = society.name;
    ctx.features = effectiveFeatures(society);
  }

  if (!ctx.impersonationId && ctx.societyId) {
    if (user.userType === UserType.SOCIETY_ADMIN) {
      const profile: any = await AdminProfile.findOne({ userId: user._id, societyId: ctx.societyId, status: ProfileStatus.ACTIVE }).populate('roleId', 'permissions');
      if (!profile) throw ApiError.forbidden('No active admin access for this society', 'NO_ADMIN_ACCESS');
      ctx.adminProfileId = String(profile._id);
      ctx.permissions = computePermissions(profile.roleId?.permissions, profile.extraPermissions, profile.revokedPermissions);
    } else if (user.userType === UserType.GUARD) {
      const guard = await Guard.findOne({ userId: user._id, societyId: ctx.societyId, status: ProfileStatus.ACTIVE });
      if (!guard) throw ApiError.forbidden('No active guard assignment for this society', 'NO_GUARD_ACCESS');
      ctx.guardId = String(guard._id);
      ctx.gateId = String(guard.gateId);
    } else if (user.userType === UserType.RESIDENT) {
      const residents = await Resident.find({ userId: user._id, societyId: ctx.societyId, status: ResidentStatus.APPROVED });
      ctx.residents = residents.map((r: any) => ({
        id: String(r._id),
        flatId: String(r.flatId),
        residentType: r.residentType,
        isPrimary: r.isPrimary,
        permissions: r.permissions?.toObject ? r.permissions.toObject() : { ...r.permissions },
      }));
      ctx.flatIds = ctx.residents.map((r) => r.flatId);
      if (!ctx.residents.length) throw ApiError.forbidden('No approved residency in this society', 'NO_RESIDENCY');
    }
  }
  return ctx;
}

export const authenticate = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) throw ApiError.unauthorized('Missing bearer token', 'TOKEN_MISSING');
    req.auth = await buildAuthContext(header.slice(7).trim());
    next();
  } catch (err) {
    next(err);
  }
};

export const authenticateLoose = async (req: Request, _res: Response, next: NextFunction) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) throw ApiError.unauthorized('Missing bearer token', 'TOKEN_MISSING');
    let payload;
    try {
      payload = verifyAccessToken(header.slice(7).trim());
    } catch {
      throw ApiError.unauthorized('Invalid or expired access token', 'TOKEN_INVALID');
    }
    const user = await User.findOne({ _id: payload.sub }).select('+tokenVersion');
    if (!user || !user.isActive || user.tokenVersion !== payload.tv) throw ApiError.unauthorized('Session is no longer valid', 'TOKEN_REVOKED');
    req.auth = { userId: String(user._id), userType: user.userType, role: user.userType, societyId: payload.sid, permissions: new Set(), features: {}, residents: [], flatIds: [] };
    next();
  } catch (err) {
    next(err);
  }
};
