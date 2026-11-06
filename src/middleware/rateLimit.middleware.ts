import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

const handler = (_req: any, res: any) =>
  res.status(429).json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } });

export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

export const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});
