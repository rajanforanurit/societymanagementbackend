import { RequestHandler } from 'express';
import { ApiError } from '../common/utils/apiError';

export const requirePermissions =
  (permissions: string[]): RequestHandler =>
  (req, _res, next) => {
    const missing = permissions.filter((p) => !req.auth.permissions.has(p));
    if (missing.length) {
      return next(ApiError.forbidden(`Missing required permission: ${missing.join(', ')}`, 'PERMISSION_DENIED'));
    }
    next();
  };
