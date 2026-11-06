import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const idParam = z.object({ id: objectId });
export const dateTime = z.iso.datetime({ offset: true });
export const dateOnly = z.iso.date();
export const dateOrDateTime = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
export const mobile = z.string().regex(/^\+?[1-9][\d\s-]{8,16}$/, 'Invalid mobile number');
export const email = z.email().max(254);
export const password = z
  .string()
  .min(8)
  .max(72)
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/\d/, 'Must contain a digit');
export const money = z.number().min(0).max(1_000_000_000);
export const url = z.string().url().max(2048);
export const otpCode = z.string().regex(/^\d{4,8}$/, 'Invalid OTP');
export const shortText = z.string().trim().min(1).max(200);
export const longText = z.string().trim().min(1).max(5000);
export const boolQuery = z.enum(['true', 'false']).transform((v) => v === 'true');
export const idList = z.array(objectId).max(100);

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .string()
    .regex(/^-?[A-Za-z_.]+(,-?[A-Za-z_.]+)*$/)
    .optional(),
  search: z.string().trim().min(1).max(100).optional(),
  from: dateOrDateTime.optional(),
  to: dateOrDateTime.optional(),
});

export const address = z.object({
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  country: z.string().trim().max(100).optional(),
  pincode: z.string().trim().max(12).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
