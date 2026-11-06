import { z } from 'zod';
import { ApprovalEntityType, ApprovalStatus, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateTime, listQuery, objectId } from '../../common/validators/common';

export const approvalQuery = listQuery.extend({ entityType: z.enum(vals(ApprovalEntityType)).optional(), status: z.enum(vals(ApprovalStatus)).optional(), submittedBy: objectId.optional() });
export const decisionBody = z.object({ reason: z.string().trim().min(3).max(1000).optional() });
export const reasonRequiredBody = z.object({ reason: z.string().trim().min(3).max(1000) });
export const approvalItem = entity({
  entityType: z.enum(vals(ApprovalEntityType)),
  entityId: objectId,
  title: z.string(),
  summary: z.string().optional(),
  status: z.enum(vals(ApprovalStatus)),
  submittedBy: objectId,
  reviewerId: objectId.optional(),
  submittedAt: dateTime.optional(),
  decidedAt: dateTime.optional(),
  version: z.number().int(),
  history: z.array(z.object({ from: z.string().optional(), to: z.string(), by: objectId.optional(), byRole: z.string().optional(), reason: z.string().optional(), at: dateTime })),
});
