import { z } from 'zod';
import { ProfileStatus, Shift, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateTime, email, listQuery, mobile, objectId, password } from '../../common/validators/common';

export const createGuardBody = z.object({
  name: z.string().trim().min(2).max(120),
  mobile,
  email: email.optional(),
  password,
  gateId: objectId,
  employeeCode: z.string().max(30).optional(),
  agency: z.string().max(100).optional(),
  shift: z.enum(vals(Shift)).default('GENERAL'),
});
export const updateGuardBody = z.object({ gateId: objectId, employeeCode: z.string().max(30), agency: z.string().max(100), shift: z.enum(vals(Shift)), status: z.enum(vals(ProfileStatus)) }).partial();
export const guardQuery = listQuery.extend({ gateId: objectId.optional(), status: z.enum(vals(ProfileStatus)).optional(), shift: z.enum(vals(Shift)).optional() });
export const guardItem = entity({
  userId: objectId,
  gateId: objectId,
  employeeCode: z.string().optional(),
  agency: z.string().optional(),
  shift: z.enum(vals(Shift)),
  status: z.enum(vals(ProfileStatus)),
  user: z.object({ id: objectId, name: z.string(), mobile: z.string(), lastLoginAt: dateTime.optional() }).optional(),
});
