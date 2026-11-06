import { z } from 'zod';
import { AssigneeType, ComplaintCategory, ComplaintStatus, Priority, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateTime, listQuery, objectId } from '../../common/validators/common';

const cat = z.enum(vals(ComplaintCategory));
const pri = z.enum(vals(Priority));
const status = z.enum(vals(ComplaintStatus));

export const raiseBody = z.object({ flatId: objectId.optional(), category: cat, title: z.string().trim().min(5).max(150), description: z.string().trim().min(10).max(3000), priority: pri.default('MEDIUM'), attachments: z.array(objectId).max(5).default([]) });
export const commentBody = z.object({ message: z.string().trim().min(1).max(2000), attachments: z.array(objectId).max(3).default([]), isInternal: z.boolean().default(false) });
export const residentCommentBody = commentBody.omit({ isInternal: true });
export const rateBody = z.object({ score: z.number().int().min(1).max(5), feedback: z.string().max(500).optional() });
export const reopenBody = z.object({ reason: z.string().trim().min(5).max(500) });
export const commentItem = z.object({ authorId: objectId, authorRole: z.string().optional(), message: z.string(), isInternal: z.boolean().optional(), at: dateTime });
export const complaintItem = entity({
  ticketNumber: z.string(),
  flatId: objectId.optional(),
  flatLabel: z.string().optional(),
  raisedBy: objectId,
  category: cat,
  title: z.string(),
  description: z.string(),
  priority: pri,
  status,
  attachments: z.array(objectId),
  assignee: z.object({ type: z.enum(vals(AssigneeType)).optional(), refId: objectId.optional(), name: z.string().optional() }).optional(),
  dueAt: dateTime.optional(),
  slaHours: z.number().optional(),
  escalationLevel: z.number().int(),
  resolvedAt: dateTime.optional(),
  reopenedCount: z.number().int(),
  rating: z.object({ score: z.number().int().optional(), feedback: z.string().optional() }).optional(),
  comments: z.array(commentItem),
  history: z.array(z.object({ status: z.string().optional(), note: z.string().optional(), at: dateTime })),
});
export const complaintQuery = listQuery.extend({ status: status.optional(), category: cat.optional(), priority: pri.optional() });
export const adminComplaintQuery = complaintQuery.extend({ assigneeType: z.enum(vals(AssigneeType)).optional(), assigneeId: objectId.optional(), overdue: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), flatId: objectId.optional() });
export const adminUpdateBody = z.object({ status: status.optional(), priority: pri.optional(), slaHours: z.number().int().min(1).max(720).optional(), note: z.string().max(500).optional() });
export const assignBody = z.object({ assigneeType: z.enum(vals(AssigneeType)), assigneeId: objectId, note: z.string().max(500).optional(), slaHours: z.number().int().min(1).max(720).optional() });
export const escalateBody = z.object({ reason: z.string().trim().min(5).max(500) });
export const complaintReport = z.object({
  total: z.number().int(),
  byStatus: z.record(z.string(), z.number()),
  byCategory: z.record(z.string(), z.number()),
  overdue: z.number().int(),
  avgResolutionHours: z.number().nullable(),
  avgRating: z.number().nullable(),
});
export const reportQuery = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });
