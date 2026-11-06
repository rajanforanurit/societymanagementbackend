import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { env } from '../../config/env';

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
export const hmac = (v: string, secret: string = env.JWT_ACCESS_SECRET) => createHmac('sha256', secret).update(v).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('hex');
export const uuid = () => randomUUID();
export const randomDigits = (len: number) => Array.from({ length: len }, () => randomInt(0, 10)).join('');
export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
