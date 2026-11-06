import { z } from 'zod';
import { ApprovalStatus, MoveType, ResidentStatus, ResidentType, vals } from '../../common/constants/enums';
import { entity, globalEntity } from '../../common/responses/schemas';
import { dateOnly, dateTime, email, listQuery, objectId, mobile } from '../../common/validators/common';

const permissions = z.object({ canApproveVisitors: z.boolean(), canPayBills: z.boolean(), canBookAmenities: z.boolean(), canRaiseComplaints: z.boolean(), canListProperties: z.boolean() });
export const verificationDoc = z.object({ type: z.string().trim().min(2).max(50), fileId: objectId });

export const societyRequestBody = z.object({
  societyId: objectId,
  flatId: objectId,
  residentType: z.enum(vals(ResidentType)),
  relationToPrimary: z.string().max(50).optional(),
  documents: z.array(verificationDoc).max(10).default([]),
  tenancy: z.object({ startDate: dateOnly, endDate: dateOnly.optional(), monthlyRent: z.number().min(0).optional(), landlordName: z.string().max(120).optional() }).optional(),
});
export const addDocumentBody = verificationDoc;

export const residentItem = entity({
  userId: objectId,
  flatId: objectId,
  residentType: z.enum(vals(ResidentType)),
  status: z.enum(vals(ResidentStatus)),
  isPrimary: z.boolean(),
  ownershipVerified: z.boolean(),
  permissions,
  moveInDate: dateTime.optional(),
  rejectionReason: z.string().optional(),
  user: z.object({ id: objectId, name: z.string(), mobile: z.string().optional(), email: z.string().optional() }).optional(),
  flat: z.object({ id: objectId, label: z.string() }).optional(),
});
export const residentQuery = listQuery.extend({ status: z.enum(vals(ResidentStatus)).optional(), flatId: objectId.optional(), residentType: z.enum(vals(ResidentType)).optional(), userId: objectId.optional() });
export const rejectBody = z.object({ reason: z.string().trim().min(3).max(500) });
export const adminResidentUpdate = z.object({ flatId: objectId, residentType: z.enum(vals(ResidentType)), isPrimary: z.boolean(), permissions: permissions.partial(), verificationNotes: z.string().max(500) }).partial();
export const verificationBody = z.object({ ownershipVerified: z.boolean(), documentTypes: z.array(z.string()).optional(), notes: z.string().max(500).optional() });
export const statusReasonBody = z.object({ reason: z.string().max(500).optional() });

export const profileUpdateBody = z.object({ name: z.string().trim().min(2).max(120), email: email, avatarFileId: objectId }).partial();
export const notificationPrefsBody = z.object({ visitor: z.boolean(), delivery: z.boolean(), payment: z.boolean(), complaint: z.boolean(), marketplace: z.boolean(), announcement: z.boolean(), booking: z.boolean(), chat: z.boolean(), push: z.boolean(), sms: z.boolean(), email: z.boolean() }).partial();
export const profileItem = globalEntity({ name: z.string(), mobile: z.string(), email: z.string().optional(), notificationPrefs: z.record(z.string(), z.boolean()).optional() });

export const familyBody = z.object({ flatId: objectId, name: z.string().trim().min(2).max(120), relation: z.string().trim().min(2).max(50), dateOfBirth: dateOnly.optional(), mobile: mobile.optional(), isMinor: z.boolean().default(false), canApproveVisitors: z.boolean().default(false) });
export const familyQuery = listQuery.extend({ flatId: objectId.optional() });
export const familyItem = entity({ residentId: objectId, userId: objectId, flatId: objectId, name: z.string(), relation: z.string(), mobile: z.string().optional(), isMinor: z.boolean(), canApproveVisitors: z.boolean() });

export const moveBody = z.object({ flatId: objectId.optional(), type: z.enum(vals(MoveType)), date: dateOnly, notes: z.string().max(500).optional(), vehicleDetails: z.string().max(200).optional() });
export const moveQuery = listQuery.extend({ status: z.enum(vals(ApprovalStatus)).optional(), type: z.enum(vals(MoveType)).optional() });
export const moveItem = entity({ userId: objectId, residentId: objectId, flatId: objectId, type: z.enum(vals(MoveType)), date: z.string(), notes: z.string().optional(), status: z.enum(vals(ApprovalStatus)), rejectionReason: z.string().optional() });
