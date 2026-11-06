import { z } from 'zod';
import { AttendanceStatus, DomesticHelpStatus, DomesticHelpType, HelpPaymentType, ServiceCategory, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateOnly, dateTime, listQuery, mobile, money, objectId } from '../../common/validators/common';

const hType = z.enum(vals(DomesticHelpType));
export const registerHelpBody = z.object({ name: z.string().trim().min(2).max(120), mobile, helpType: hType, photoFileId: objectId.optional(), idProofFileId: objectId.optional(), flatId: objectId.optional(), salaryMonthly: money.optional() });
export const hireBody = z.object({ flatId: objectId.optional(), salaryMonthly: money.optional() });
export const helpItem = entity({
  name: z.string(),
  mobile: z.string(),
  helpType: hType,
  status: z.enum(vals(DomesticHelpStatus)),
  code: z.string().optional(),
  flats: z.array(z.object({ flatId: objectId, flatLabel: z.string().optional(), salaryMonthly: z.number().optional() })),
  ratingAvg: z.number(),
  ratingCount: z.number().int(),
});
export const helpDirectoryItem = z.object({ id: objectId, name: z.string(), helpType: hType, ratingAvg: z.number(), ratingCount: z.number().int() });
export const helpQuery = listQuery.extend({ status: z.enum(vals(DomesticHelpStatus)).optional(), helpType: hType.optional() });
export const directoryQuery = listQuery.extend({ helpType: hType.optional() });
export const verifyHelpBody = z.object({ decision: z.enum(['VERIFY', 'REJECT', 'SUSPEND']), reason: z.string().max(300).optional() });
export const attendanceBody = z.object({ date: dateOnly, flatId: objectId.optional(), status: z.enum(vals(AttendanceStatus)), note: z.string().max(200).optional() });
export const attendanceQuery = z.object({ from: dateOnly.optional(), to: dateOnly.optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(31) });
export const attendanceItem = entity({ helpId: objectId, date: z.string(), entries: z.array(z.object({ checkInAt: dateTime.optional(), checkOutAt: dateTime.optional() })), marks: z.array(z.object({ flatId: objectId, status: z.enum(vals(AttendanceStatus)), note: z.string().optional() })) });
export const paymentBody = z.object({ flatId: objectId.optional(), type: z.enum(vals(HelpPaymentType)), amount: money, month: z.string().regex(/^\d{4}-\d{2}$/).optional(), paidOn: dateOnly, note: z.string().max(200).optional() });
export const paymentItem = entity({ helpId: objectId, flatId: objectId, type: z.enum(vals(HelpPaymentType)), amount: z.number(), month: z.string().optional(), paidOn: z.string(), note: z.string().optional() });
export const paymentQuery = listQuery.extend({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });

const sCat = z.enum(vals(ServiceCategory));
export const providerBody = z.object({ name: z.string().trim().min(2).max(120), category: sCat, mobile, description: z.string().max(500).optional(), verified: z.boolean().default(false), status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE') });
export const providerQuery = listQuery.extend({ category: sCat.optional(), verified: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });
export const providerItem = entity({ name: z.string(), category: sCat, mobile: z.string(), description: z.string().optional(), verified: z.boolean(), status: z.string(), ratingAvg: z.number(), ratingCount: z.number().int() });
export const reviewBody = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(500).optional() });
export const reviewItem = entity({ providerId: objectId, userId: objectId, rating: z.number().int(), comment: z.string().optional() });

export const guardHelpVerifyBody = z.object({ code: z.string().regex(/^\d{6}$/) });
export const guardHelpGateBody = z.object({ code: z.string().regex(/^\d{6}$/) });
export const unauthorizedReportBody = z.object({ helpId: objectId.optional(), name: z.string().max(120).optional(), flatId: objectId.optional(), description: z.string().trim().min(5).max(500) });
export const guardHelpView = z.object({ id: objectId, name: z.string(), helpType: hType, status: z.enum(vals(DomesticHelpStatus)), assignedFlats: z.array(z.object({ flatId: objectId, flatLabel: z.string().optional() })), checkedIn: z.boolean() });
