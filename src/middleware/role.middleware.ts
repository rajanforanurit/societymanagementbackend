import { NextFunction, Request, RequestHandler, Response } from 'express';
import { UserType } from '../common/constants/enums';
import { ApiError } from '../common/utils/apiError';

export const requireRoles =
  (roles: string[]): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!roles.includes(req.auth.role)) return next(ApiError.forbidden('Your role cannot access this resource', 'FORBIDDEN_ROLE'));
    next();
  };

export const requireSociety: RequestHandler = (req, _res, next) => {
  if (req.auth.role === UserType.SUPER_ADMIN) return next();
  if (!req.auth.societyId) {
    return next(ApiError.forbidden('No active society context. Select a society first.', 'SOCIETY_CONTEXT_REQUIRED'));
  }
  next();
};

export const requireFeature =
  (feature: string): RequestHandler =>
  (req, _res, next) => {
    if (req.auth.features[feature] === false) {
      return next(ApiError.forbidden(`The "${feature}" module is disabled for this society`, 'FEATURE_DISABLED'));
    }
    next();
  };
