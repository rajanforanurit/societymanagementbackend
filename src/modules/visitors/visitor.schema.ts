import { z } from 'zod';
import { ApprovalMode, InvitationStatus, VisitorStatus, VisitorType, Weekday, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateTime, hhmm, listQuery, mobile, objectId } from '../../common/validators/common';

const vType = z.enum(vals(VisitorType));
const plate = z.string().trim().toUpperCase().regex(/^[A-Z0-9 -]{4,15}$/, 'Invalid vehicle number');

export const invitationBody = z.object({
  flatId: objectId.optional(),
  visitorName: z.string().trim().min(2).max(120),
  visitorMobile: mobile.optional(),
  visitorType: vType.default('GUEST'),
  purpose: z.string().max(200).optional(),
  vehicleNumber: plate.optional(),
  validFrom: dateTime,
  validTo: dateTime,
  recurring: z.object({ enabled: z.boolean().default(true), days: z.array(z.enum(vals(Weekday))).min(1), timeFrom: hhmm.optional(), timeTo: hhmm.optional() }).optional(),
  maxEntries: z.number().int().min(0).max(1000).default(1),
});
export const invitationQuery = listQuery.extend({ status: z.enum(vals(InvitationStatus)).optional(), flatId: objectId.optional() });
export const invitationItem = entity({
  flatId: objectId,
  flatLabel: z.string().optional(),
  visitorName: z.string(),
  visitorMobile: z.string().optional(),
  visitorType: vType,
  validFrom: dateTime,
  validTo: dateTime,
  recurring: z.object({ enabled: z.boolean(), days: z.array(z.string()) }).optional(),
  maxEntries: z.number().int(),
  usedEntries: z.number().int(),
  code: z.string(),
  qrToken: z.string().optional(),
  status: z.enum(vals(InvitationStatus)),
});

export const visitorItem = entity({
  gateId: objectId.optional(),
  flatId: objectId,
  flatLabel: z.string().optional(),
  visitorType: vType,
  name: z.string(),
  mobile: z.string().optional(),
  vehicleNumber: z.string().optional(),
  purpose: z.string().optional(),
  company: z.string().optional(),
  status: z.enum(vals(VisitorStatus)),
  approvalMode: z.enum(vals(ApprovalMode)).optional(),
  requestedAt: dateTime.optional(),
  decidedAt: dateTime.optional(),
  rejectReason: z.string().optional(),
  entryAt: dateTime.optional(),
  exitAt: dateTime.optional(),
  isEmergencyEntry: z.boolean(),
});
export const visitorQuery = listQuery.extend({ status: z.enum(vals(VisitorStatus)).optional(), visitorType: vType.optional(), flatId: objectId.optional(), gateId: objectId.optional(), mobile: z.string().max(20).optional() });
export const respondBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: z.string().max(300).optional(), flatId: objectId.optional() });

export const guardRegisterBody = z.object({
  flatId: objectId,
  name: z.string().trim().min(2).max(120),
  mobile: mobile.optional(),
  visitorType: vType.default('GUEST'),
  purpose: z.string().max(200).optional(),
  company: z.string().max(100).optional(),
  vehicleNumber: plate.optional(),
  photoFileId: objectId.optional(),
});
export const guardVisitorQuery = listQuery.extend({ status: z.enum(vals(VisitorStatus)).optional(), q: z.string().max(60).optional(), mobile: z.string().max(20).optional() });
export const verifyBody = z.object({ code: z.string().regex(/^\d{6}$/).optional(), qrToken: z.string().min(10).max(200).optional() }).refine((v) => v.code || v.qrToken, { message: 'Provide code or qrToken' });
export const denyBody = z.object({ reason: z.string().trim().min(3).max(300) });
export const emergencyEntryBody = guardRegisterBody.extend({ reason: z.string().trim().min(5).max(300) });
export const flatLookupQuery = z.object({ q: z.string().trim().min(1).max(30), limit: z.coerce.number().int().min(1).max(15).default(8) });
export const flatLookupItem = z.object({ id: objectId, label: z.string(), towerId: objectId.optional(), floorNumber: z.number().optional() });
export const expectedItem = z.object({ id: objectId, flatLabel: z.string().optional(), visitorName: z.string(), visitorType: vType, validFrom: dateTime, validTo: dateTime });
