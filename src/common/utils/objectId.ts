import { Types } from 'mongoose';

export const oid = (v: string | Types.ObjectId) => new Types.ObjectId(String(v));
export const isObjectId = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{24}$/i.test(v);
export const uniqueIds = (ids: unknown[]) => [...new Set(ids.filter(Boolean).map(String))];
