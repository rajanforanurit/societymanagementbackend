import { Request, Response } from 'express';
import { ApprovalStatus } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { created, ok } from '../../common/responses/respond';
import { crudController } from '../../common/services/crud.controller';
import { paged } from '../../common/responses/respond';
import { User } from '../auth/auth.model';
import { applyTransition } from '../approvals/approval.service';
import { familyService, moveService, residentAdmin, residentSelf, submitMoveRequest } from './resident.service';

const sid = (r: Request) => r.auth.societyId!;

export const residentAdminController = {
  list: async (req: Request, res: Response) => paged(res, await residentAdmin.list(sid(req), req.valid.query)),
  get: async (req: Request, res: Response) => ok(res, await residentAdmin.get(sid(req), req.valid.params.id)),
  approve: async (req: Request, res: Response) => ok(res, await residentAdmin.approve(sid(req), req.valid.params.id, req.auth.userId), 'Resident approved'),
  reject: async (req: Request, res: Response) => ok(res, await residentAdmin.reject(sid(req), req.valid.params.id, req.auth.userId, req.valid.body.reason), 'Resident rejected'),
  activate: async (req: Request, res: Response) => ok(res, await residentAdmin.setActive(sid(req), req.valid.params.id, req.auth.userId, true), 'Resident activated'),
  deactivate: async (req: Request, res: Response) => ok(res, await residentAdmin.setActive(sid(req), req.valid.params.id, req.auth.userId, false), 'Resident deactivated'),
  update: async (req: Request, res: Response) => ok(res, await residentAdmin.update(sid(req), req.valid.params.id, req.auth.userId, req.valid.body), 'Resident updated'),
  verify: async (req: Request, res: Response) => ok(res, await residentAdmin.verify(sid(req), req.valid.params.id, req.auth.userId, req.valid.body), 'Verification recorded'),
  moveRequests: crudController(moveService, { label: 'Move request' }).list,
};

export const residentSelfController = {
  profile: async (req: Request, res: Response) => ok(res, await User.findById(req.auth.userId)),
  updateProfile: async (req: Request, res: Response) => ok(res, await residentSelf.updateProfile(req.auth.userId, req.valid.body), 'Profile updated'),
  prefs: async (req: Request, res: Response) => ok(res, await residentSelf.updatePrefs(req.auth.userId, req.valid.body), 'Preferences updated'),
  requestMembership: async (req: Request, res: Response) => created(res, await residentSelf.requestMembership(req.auth.userId, req.valid.body), 'Request submitted for approval'),
  mine: async (req: Request, res: Response) => ok(res, await residentSelf.mine(req.auth.userId)),
  addDocument: async (req: Request, res: Response) => ok(res, await residentSelf.addDocument(req.auth.userId, req.valid.params.id, req.valid.body), 'Document attached'),
  cancel: async (req: Request, res: Response) => {
    await residentSelf.cancel(req.auth.userId, req.valid.params.id);
    ok(res, null, 'Request cancelled');
  },
};

const ownFlat = (req: Request, flatId?: string) => {
  if (flatId && !req.auth.flatIds.includes(flatId)) throw ApiError.forbidden('You do not belong to this flat', 'FLAT_FORBIDDEN');
};

export const familyController = crudController(familyService, {
  label: 'Family member',
  scope: (req) => ({ userId: req.auth.userId }),
  prepare: (req, b) => {
    ownFlat(req, b.flatId);
    const r = req.auth.residents.find((x) => x.flatId === b.flatId);
    return { ...b, userId: req.auth.userId, residentId: r!.id };
  },
});

export const moveController = {
  list: crudController(moveService, { label: 'Move request', scope: (req) => ({ userId: req.auth.userId }) }).list,
  get: crudController(moveService, { label: 'Move request', scope: (req) => ({ userId: req.auth.userId }) }).get,
  create: async (req: Request, res: Response) => created(res, await submitMoveRequest(sid(req), req.auth.userId, req.auth.residents, req.valid.body), 'Move request submitted'),
  withdraw: async (req: Request, res: Response) => {
    const r = await applyTransition('MOVE_REQUEST', req.valid.params.id, ApprovalStatus.DRAFT, { userId: req.auth.userId, role: 'RESIDENT', societyId: sid(req) }, { ownerOnly: true });
    ok(res, r, 'Move request withdrawn');
  },
};
