export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    Object.setPrototypeOf(this, ApiError.prototype);
  }
  static badRequest(message = 'Bad request', code = 'BAD_REQUEST', details?: unknown) {
    return new ApiError(400, code, message, details);
  }
  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new ApiError(401, code, message);
  }
  static forbidden(message = 'You do not have permission to perform this action', code = 'FORBIDDEN') {
    return new ApiError(403, code, message);
  }
  static notFound(message = 'Resource not found', code = 'NOT_FOUND') {
    return new ApiError(404, code, message);
  }
  static conflict(message = 'Conflict', code = 'CONFLICT', details?: unknown) {
    return new ApiError(409, code, message, details);
  }
  static validation(details: unknown, message = 'Request validation failed') {
    return new ApiError(422, 'VALIDATION_ERROR', message, details);
  }
  static tooMany(message = 'Too many requests', code = 'RATE_LIMITED') {
    return new ApiError(429, code, message);
  }
}
