import { Request, Response } from 'express';
import { ApprovalStatus } from '../../common/constants/enums';
import { ok, paged } from '../../common/responses/respond';
import { createCrudService } from '../../common/services/crud.service';
import { ApprovalRequest } from './approval.model';
import { applyTransition, getApproval } from './approval.service';

const svc = createCrudService({ model: ApprovalRequest, name: 'Approval request', searchFields: ['title'], filterable: ['entityType', 'status', 'submittedBy'], sortable: ['createdAt', 'submittedAt', 'updatedAt'] });

const act = (to: ApprovalStatus, message: string) => async (req: Request, res: Response) => {
  const a: any = await getApproval(req.auth.societyId!, req.valid.params.id);
  await applyTransition(a.entityType, String(a.entityId), to, { userId: req.auth.userId, role: req.auth.role, societyId: req.auth.societyId! }, { reason: req.valid.body?.reason });
  ok(res, await getApproval(req.auth.societyId!, req.valid.params.id), message);
};

export const approvalController = {
  list: async (req: Request, res: Response) => paged(res, await svc.list(req.auth.societyId!, req.valid.query)),
  get: async (req: Request, res: Response) => ok(res, await getApproval(req.auth.societyId!, req.valid.params.id)),
  startReview: act('UNDER_REVIEW', 'Review started'),
  approve: act('APPROVED', 'Approved'),
  reject: act('REJECTED', 'Rejected'),
  requestChanges: act('CHANGES_REQUESTED', 'Changes requested'),
  suspend: act('SUSPENDED', 'Suspended'),
  remove: act('REMOVED', 'Removed'),
  restore: act('PUBLISHED', 'Restored'),
};
