import { z } from 'zod';
import { DeliveryStatus, DeliveryType, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateTime, listQuery, mobile, objectId } from '../../common/validators/common';

export const deliveryItem = entity({
  gateId: objectId.optional(),
  flatId: objectId,
  flatLabel: z.string().optional(),
  company: z.string(),
  deliveryType: z.enum(vals(DeliveryType)),
  agentName: z.string(),
  agentMobile: z.string().optional(),
  status: z.enum(vals(DeliveryStatus)),
  leaveAtGate: z.boolean(),
  parcelReceivedAt: dateTime.optional(),
  collectedAt: dateTime.optional(),
  entryAt: dateTime.optional(),
  exitAt: dateTime.optional(),
  rejectReason: z.string().optional(),
});
export const deliveryQuery = listQuery.extend({ status: z.enum(vals(DeliveryStatus)).optional(), flatId: objectId.optional(), deliveryType: z.enum(vals(DeliveryType)).optional() });
export const guardDeliveryBody = z.object({ flatId: objectId, company: z.string().trim().min(2).max(80), deliveryType: z.enum(vals(DeliveryType)).default('PARCEL'), agentName: z.string().trim().min(2).max(120), agentMobile: mobile.optional(), photoFileId: objectId.optional(), note: z.string().max(200).optional() });
export const deliveryRespondBody = z.object({ decision: z.enum(['APPROVE', 'REJECT', 'LEAVE_AT_GATE']), reason: z.string().max(300).optional() });
export const handoverBody = z.object({ otp: z.string().regex(/^\d{6}$/) });
export const parcelReceivedResponse = deliveryItem.extend({ message: z.string().optional() });
export const deliveryPrefBody = z.object({ flatId: objectId.optional(), leaveAtGate: z.boolean().optional(), autoApprove: z.boolean().optional() });
export const deliveryPrefItem = z.object({ flatId: objectId, leaveAtGate: z.boolean(), autoApprove: z.boolean() });
