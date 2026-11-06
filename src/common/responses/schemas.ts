import { z } from 'zod';
import { dateTime, objectId } from '../validators/common';

export const baseEntity = {
  id: objectId,
  societyId: objectId,
  createdBy: objectId.optional(),
  updatedBy: objectId.optional(),
  createdAt: dateTime,
  updatedAt: dateTime,
};

export const entity = <T extends z.ZodRawShape>(shape: T) => z.object({ ...baseEntity, ...shape });
export const globalEntity = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ id: objectId, createdAt: dateTime, updatedAt: dateTime, ...shape });

export const messageData = z.object({ message: z.string() });
export const idData = z.object({ id: objectId });

export const paginationMeta = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});
