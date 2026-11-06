import { z } from 'zod';
import { AlertStatus, EmergencyType, IncidentStatus, IncidentType, LostFoundStatus, LostFoundType, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateTime, listQuery, objectId } from '../../common/validators/common';

const eType = z.enum(vals(EmergencyType));
export const panicBody = z.object({ type: eType.default('PANIC'), flatId: objectId.optional(), message: z.string().max(300).optional(), location: z.string().max(200).optional() });
export const guardAlertBody = z.object({ type: eType.default('SECURITY'), message: z.string().trim().min(3).max(300), location: z.string().max(200).optional(), flatId: objectId.optional() });
export const alertItem = entity({
  type: eType,
  source: z.enum(['RESIDENT', 'GUARD', 'ADMIN']),
  raisedBy: objectId,
  flatId: objectId.optional(),
  flatLabel: z.string().optional(),
  gateId: objectId.optional(),
  location: z.string().optional(),
  message: z.string().optional(),
  status: z.enum(vals(AlertStatus)),
  acknowledgedAt: dateTime.optional(),
  resolvedAt: dateTime.optional(),
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

export const contactBody = z.object({ name: z.string().trim().min(2).max(100), category: z.string().max(40).default('OTHER'), phone: z.string().trim().min(3).max(20), notes: z.string().max(300).optional(), order: z.number().int().default(0) });
export const contactItem = entity({ scope: z.enum(['SOCIETY', 'PERSONAL']), name: z.string(), category: z.string(), phone: z.string(), notes: z.string().optional(), order: z.number().int() });
export const contactQuery = listQuery;
