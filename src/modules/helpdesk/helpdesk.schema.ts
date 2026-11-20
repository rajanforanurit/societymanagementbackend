import { z } from 'zod';
import { entity } from '../../common/responses/schemas';
import { listQuery, mobile } from '../../common/validators/common';

export const HELPDESK_CATEGORIES = ['PLUMBER', 'ELECTRICIAN', 'MECHANIC', 'DOCTOR', 'CARPENTER', 'PAINTER', 'PEST_CONTROL', 'APPLIANCE_REPAIR', 'CLEANING', 'GAS_AGENCY', 'WATER_SUPPLIER', 'TAXI', 'OTHER'] as const;

/** Free text such as "Pest control" becomes a stable key (PEST_CONTROL). Custom categories are allowed. */
export const categoryKey = z.string().trim().min(2).max(40).transform((v) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')).refine((v) => v.length >= 2, 'Invalid category');

const fields = {
  name: z.string().trim().min(2).max(100),
  mobile,
  alternateMobile: mobile.optional(),
  category: categoryKey,
  designation: z.string().trim().max(100).optional(),
  description: z.string().trim().max(500).optional(),
  availability: z.string().trim().max(100).optional(),
  isVisible: z.boolean(),
  order: z.number().int().min(0).max(10000),
};
export const helpdeskBody = z.object({ ...fields, isVisible: fields.isVisible.default(true), order: fields.order.default(0) });
// Explicit update schema: .partial() of a schema with defaults would silently reset untouched fields.
export const helpdeskUpdate = z.object({ ...fields }).partial();
export const helpdeskQuery = listQuery.extend({ category: categoryKey.optional(), isVisible: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });
export const residentHelpdeskQuery = listQuery.extend({ category: categoryKey.optional() });
export const helpdeskItem = entity({ name: z.string(), mobile: z.string(), alternateMobile: z.string().optional(), category: z.string(), designation: z.string().optional(), description: z.string().optional(), availability: z.string().optional(), isVisible: z.boolean(), order: z.number().int() });
export const residentHelpdeskItem = z.object({ id: z.string(), name: z.string(), mobile: z.string(), alternateMobile: z.string().optional(), category: z.string(), designation: z.string().optional(), description: z.string().optional(), availability: z.string().optional() });
export const categoryItem = z.object({ category: z.string(), count: z.number().int() });
