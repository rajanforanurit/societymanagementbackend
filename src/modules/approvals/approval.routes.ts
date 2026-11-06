import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { ModuleRouter } from '../../common/openapi/router';
import { idParam } from '../../common/validators/common';
import { approvalController as c } from './approval.controller';
import * as s from './approval.schema';

export const approvalRouter = new ModuleRouter('/api/v1/admin/approvals', {
  tag: 'Approvals',
  tagDescription: 'Reusable approval workflow: DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED → PUBLISHED → EXPIRED/REMOVED. Used by marketplace listings, property listings, community posts and move-in/out requests.',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
});

const base = { permissions: [P.APPROVAL_REVIEW], params: idParam, response: s.approvalItem, status: 200, errors: [409] };
approvalRouter
  .add({ method: 'get', path: '/', summary: 'List approval requests (moderation queue)', description: 'Use status=SUBMITTED to see the pending queue.', permissions: [P.APPROVAL_REVIEW], query: s.approvalQuery, response: s.approvalItem, paginated: true, handler: c.list })
  .add({ method: 'get', path: '/:id', summary: 'Get approval request with full history', permissions: [P.APPROVAL_REVIEW], params: idParam, response: s.approvalItem, handler: c.get })
  .add({ ...base, method: 'post', path: '/:id/start-review', summary: 'Move to UNDER_REVIEW', body: s.decisionBody, handler: c.startReview })
  .add({ ...base, method: 'post', path: '/:id/approve', summary: 'Approve (auto-publishes when the society setting is on)', body: s.decisionBody, handler: c.approve })
  .add({ ...base, method: 'post', path: '/:id/reject', summary: 'Reject with a reason', body: s.reasonRequiredBody, handler: c.reject })
  .add({ ...base, method: 'post', path: '/:id/request-changes', summary: 'Request modifications from the submitter', body: s.reasonRequiredBody, handler: c.requestChanges })
  .add({ ...base, method: 'post', path: '/:id/suspend', summary: 'Suspend a published item (hidden from residents)', body: s.reasonRequiredBody, handler: c.suspend })
  .add({ ...base, method: 'post', path: '/:id/restore', summary: 'Restore a suspended item to PUBLISHED', body: s.decisionBody, handler: c.restore })
  .add({ ...base, method: 'post', path: '/:id/remove', summary: 'Remove an item permanently from circulation', body: s.decisionBody, handler: c.remove });
