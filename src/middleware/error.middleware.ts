import { randomUUID } from 'crypto';
import { ErrorRequestHandler, RequestHandler } from 'express';
import { ApiError } from '../common/utils/apiError';
import { logger } from '../common/utils/logger';
import { env } from '../config/env';
import { ErrorLog } from '../modules/super-admin/super-admin.model';

export const requestContext: RequestHandler = (req, res, next) => {
  req.requestId = (req.headers['x-request-id'] as string) || randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `Route ${req.method} ${req.path} not found`));
};

const normalize = (err: any): ApiError => {
  if (err instanceof ApiError) return err;
  if (err?.type === 'entity.parse.failed') return ApiError.badRequest('Malformed JSON body', 'MALFORMED_JSON');
  if (err?.type === 'entity.too.large') return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large');
  if (err?.name === 'ValidationError' && err.errors) {
    return ApiError.validation(Object.values<any>(err.errors).map((e) => ({ location: 'database', path: e.path, message: e.message, code: e.kind })));
  }
  if (err?.name === 'CastError') return ApiError.badRequest(`Invalid value for ${err.path}`, 'INVALID_ID');
  if (err?.code === 11000) return ApiError.conflict('A record with the same unique value already exists', 'DUPLICATE_KEY', Object.keys(err.keyPattern ?? {}));
  if (err?.name === 'MulterError') return new ApiError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'UPLOAD_ERROR', err.message);
  if (err?.name === 'TokenExpiredError' || err?.name === 'JsonWebTokenError') return ApiError.unauthorized('Invalid or expired token', 'TOKEN_INVALID');
  if (String(err?.message ?? '').startsWith('Tenant isolation violation')) return new ApiError(500, 'TENANT_GUARD', 'Internal server error');
  return new ApiError(500, 'INTERNAL_ERROR', 'Internal server error');
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const apiError = normalize(err);
  if (apiError.status >= 500) {
    logger.error('request_failed', { requestId: req.requestId, method: req.method, path: req.originalUrl, error: err?.message, stack: env.isProd ? undefined : err?.stack });
  }
  if (apiError.status >= 500 || [401, 403, 429].includes(apiError.status)) {
    ErrorLog.create({
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: apiError.status,
      code: apiError.code,
      message: apiError.message,
      stack: apiError.status >= 500 ? String(err?.stack ?? '').slice(0, 4000) : undefined,
      userId: req.auth?.userId,
      societyId: req.auth?.societyId,
      ip: req.ip,
    }).catch(() => undefined);
  }
  res.status(apiError.status).json({
    success: false,
    error: { code: apiError.code, message: apiError.message, ...(apiError.details ? { details: apiError.details } : {}) },
    requestId: req.requestId,
  });
};
