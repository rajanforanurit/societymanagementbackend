process.env.NODE_ENV ??= 'test';

if (process.env.NODE_ENV === 'test') {
  process.env.JWT_ACCESS_SECRET ??= 'test-only-jwt-access-key';
  process.env.JWT_REFRESH_SECRET ??= 'test-only-jwt-refresh-key';
}
