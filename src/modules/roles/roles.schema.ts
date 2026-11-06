import { z } from 'zod';
import { ALL_PERMISSIONS } from '../../common/constants/permissions';
import { entity, globalEntity } from '../../common/responses/schemas';
import { listQuery } from '../../common/validators/common';

const perm = z.enum(ALL_PERMISSIONS as [string, ...string[]]);
export const roleBody = z.object({ key: z.string().trim().toUpperCase().regex(/^[A-Z_]{3,30}$/), name: z.string().trim().min(2).max(80), description: z.string().max(300).optional(), permissions: z.array(perm).max(100) });
export const roleQuery = listQuery.extend({ isSystem: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });
export const roleItem = entity({ key: z.string(), name: z.string(), description: z.string().optional(), permissions: z.array(z.string()), isSystem: z.boolean() });
export const templateItem = globalEntity({ key: z.string(), name: z.string(), description: z.string().optional(), permissions: z.array(z.string()), isActive: z.boolean() });
export const templateBody = roleBody.extend({ isActive: z.boolean().default(true) });
export const permissionCatalog = z.array(z.object({ key: z.string(), resource: z.string(), action: z.string() }));
export const rolePermissionsPatch = z.object({ permissions: z.array(perm).max(100) });
