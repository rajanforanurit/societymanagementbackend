import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/society_management?replicaSet=rs0'),
    ENABLE_TRANSACTIONS: bool.default(true),
    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
    IMPERSONATION_MAX_MINUTES: z.coerce.number().int().default(60),
    OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_TTL_MINUTES: z.coerce.number().int().default(5),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().default(5),
    OTP_RESEND_SECONDS: z.coerce.number().int().default(30),
    EXPOSE_DEV_OTP: bool.default(true),
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    CORS_ORIGINS: z.string().default('*'),
    UPLOAD_DIR: z.string().default('uploads'),
    MAX_UPLOAD_MB: z.coerce.number().default(5),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().default(900000),
    RATE_LIMIT_MAX: z.coerce.number().int().default(1000),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().default(40),
    PAYMENT_GATEWAY: z.enum(['mock']).default('mock'),
    PAYMENT_WEBHOOK_SECRET: z.string().min(8).default('dev-payment-secret'),
    SCHEDULER_ENABLED: bool.default(true),
    SUPER_ADMIN_NAME: z.string().default('Platform Owner'),
    SUPER_ADMIN_EMAIL: z.string().default('superadmin@example.com'),
    SUPER_ADMIN_MOBILE: z.string().default('+919999999999'),
    SUPER_ADMIN_PASSWORD: z.string().default('ChangeMe@123'),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production' && v.EXPOSE_DEV_OTP) {
      ctx.addIssue({ code: 'custom', path: ['EXPOSE_DEV_OTP'], message: 'EXPOSE_DEV_OTP must be false in production' });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  process.stderr.write(`Invalid environment configuration:\n${JSON.stringify(parsed.error.issues, null, 2)}\n`);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  isProd: parsed.data.NODE_ENV === 'production',
  corsOrigins: parsed.data.CORS_ORIGINS === '*' ? '*' : parsed.data.CORS_ORIGINS.split(',').map((s) => s.trim()),
};
