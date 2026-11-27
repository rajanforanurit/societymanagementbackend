import { z } from 'zod';
import { AlertStatus, EmergencyType, IncidentStatus, IncidentType, LostFoundStatus, LostFoundType, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateTime, listQuery, objectId } from '../../common/validators/common';

export const EMERGENCY_CONTACT_CATEGORIES = ['POLICE', 'FIRE', 'AMBULANCE', 'HOSPITAL', 'SOCIETY_OFFICE', 'SECURITY_DESK', 'ELECTRICITY', 'WATER', 'GAS', 'LIFT_SERVICE', 'OTHER'] as const;
const contactCategory = z.string().trim().min(2).max(40).transform((v) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')).refine((v) => v.length >= 2, 'Invalid category');

const eType = z.enum(vals(EmergencyType));
export const panicBody = z.object({ type: eType.default('PANIC'), flatId: objectId.optional(), message: z.string().max(300).optional(), location: z.string().max(200).optional() });
export const alarmBody = z.object({
  flat: z.string().trim().min(1).max(40).optional(),
  flatId: objectId.optional(),
  message: z.string().trim().max(300).optional(),
  confirm: z.literal(true, { error: 'Confirmation required' }),
  type: eType.default('PANIC'),
  location: z.string().max(200).optional(),
});
export const alarmResponse = z.object({ alert: z.any(), duplicate: z.boolean() });
export const staffMessageBody = z.object({ audience: z.enum(['GUARDS', 'ADMIN']), message: z.string().trim().min(2).max(1000), subject: z.string().trim().max(120).optional() });
export const staffMessageItem = entity({ fromUserId: objectId, fromName: z.string().optional(), flatLabel: z.string().optional(), audience: z.enum(['GUARDS', 'ADMIN']), subject: z.string().optional(), message: z.string() });
export const guardAlertBody = z.object({ type: eType.default('SECURITY'), message: z.string().trim().min(3).max(300), location: z.string().max(200).optional(), flatId: objectId.optional() });
export const alertItem = entity({
  type: eType,
  source: z.enum(['RESIDENT', 'GUARD', 'ADMIN']),
  raisedBy: objectId,
  raisedByName: z.string().optional(),
  raisedByMobile: z.string().optional(),
  flatId: objectId.optional(),
  flatLabel: z.string().optional(),
  gateId: objectId.optional(),
  location: z.string().optional(),
  message: z.string().optional(),
  status: z.enum(vals(AlertStatus)),
  acknowledgedAt: dateTime.optional(),
  resolvedAt: dateTime.optional(),
  acknowledgedByName: z.string().optional(),
  acknowledgedByRole: z.string().optional(),
  resolvedByName: z.string().optional(),
  resolvedByRole: z.string().optional(),
  notifiedContacts: z.array(z.object({ name: z.string().optional(), phone: z.string().optional() })).optional(),
});
export const alertQuery = listQuery.extend({ status: z.enum(vals(AlertStatus)).optional(), type: eType.optional() });
export const alertUpdateBody = z.object({ status: z.enum(['ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM']), note: z.string().max(500).optional() });

export const incidentBody = z.object({ type: z.enum(vals(IncidentType)).default('OTHER'), description: z.string().trim().min(5).max(2000), location: z.string().max(200).optional(), flatId: objectId.optional(), attachments: z.array(objectId).max(5).default([]) });
export const incidentItem = entity({ reportedBy: objectId, reporterRole: z.string().optional(), type: z.enum(vals(IncidentType)), description: z.string(), location: z.string().optional(), status: z.enum(vals(IncidentStatus)), resolutionNote: z.string().optional() });
export const incidentQuery = listQuery.extend({ status: z.enum(vals(IncidentStatus)).optional(), type: z.enum(vals(IncidentType)).optional() });
export const incidentUpdateBody = z.object({ status: z.enum(vals(IncidentStatus)), resolutionNote: z.string().max(1000).optional() });

export const lostFoundBody = z.object({ type: z.enum(vals(LostFoundType)), title: z.string().trim().min(3).max(120), description: z.string().max(1000).optional(), locationFound: z.string().max(200).optional(), images: z.array(objectId).max(5).default([]) });
export const lostFoundItem = entity({ type: z.enum(vals(LostFoundType)), reportedBy: objectId, title: z.string(), description: z.string().optional(), status: z.enum(vals(LostFoundStatus)) });
export const lostFoundQuery = listQuery.extend({ type: z.enum(vals(LostFoundType)).optional(), status: z.enum(vals(LostFoundStatus)).optional() });
export const lostFoundUpdate = z.object({ status: z.enum(vals(LostFoundStatus)) });

export const contactBody = z.object({
  name: z.string().trim().min(2).max(100),
  category: contactCategory.default('OTHER'),
  phone: z.string().trim().min(3).max(20),
  notes: z.string().max(300).optional(),
  order: z.number().int().default(0),
  visibleToResidents: z.boolean().default(true),
  visibleToGuards: z.boolean().default(true),
});
export const contactUpdate = z.object({ name: contactBody.shape.name, category: contactCategory, phone: contactBody.shape.phone, notes: z.string().max(300), order: z.number().int(), visibleToResidents: z.boolean(), visibleToGuards: z.boolean() }).partial();
export const contactCategoryItem = z.object({ category: z.string(), count: z.number().int() });
export const contactItem = entity({ scope: z.enum(['SOCIETY', 'PERSONAL']), name: z.string(), category: z.string(), phone: z.string(), notes: z.string().optional(), order: z.number().int(), visibleToResidents: z.boolean().optional(), visibleToGuards: z.boolean().optional() });
export const contactQuery = listQuery;
