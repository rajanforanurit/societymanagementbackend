import { z } from 'zod';
import { ProfileStatus, vals } from '../../common/constants/enums';
import { ALL_PERMISSIONS } from '../../common/constants/permissions';
import { entity } from '../../common/responses/schemas';
import { email, listQuery, mobile, objectId, password, dateTime } from '../../common/validators/common';

const perm = z.enum(ALL_PERMISSIONS as [string, ...string[]]);
export const createAdminBody = z.object({ name: z.string().trim().min(2).max(120), mobile, email: email.optional(), password: password.optional(), roleId: objectId, designation: z.string().max(100).optional() });
export const superCreateAdminBody = createAdminBody.extend({ societyId: objectId });
export const updateAdminBody = z.object({ roleId: objectId, designation: z.string().max(100), status: z.enum(vals(ProfileStatus)) }).partial();
export const permissionsBody = z.object({ extraPermissions: z.array(perm).optional(), revokedPermissions: z.array(perm).optional(), roleId: objectId.optional() });
export const adminQuery = listQuery.extend({ status: z.enum(vals(ProfileStatus)).optional(), roleId: objectId.optional() });
export const superAdminQuery = adminQuery.extend({ societyId: objectId.optional() });
export const adminItem = entity({
  userId: objectId,
  roleId: objectId,
  designation: z.string().optional(),
  extraPermissions: z.array(z.string()),
  revokedPermissions: z.array(z.string()),
  status: z.enum(vals(ProfileStatus)),
  user: z.object({ id: objectId, name: z.string(), mobile: z.string(), email: z.string().optional(), lastLoginAt: dateTime.optional() }).optional(),
});
export const resetAccessResponse = z.object({ temporaryPassword: z.string() });
export const activityItem = z.object({ id: objectId, action: z.string(), entityType: z.string().optional(), entityId: z.string().optional(), createdAt: dateTime, statusCode: z.number().optional() });
