import { Request, Response } from 'express';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { idParam } from '../../common/validators/common';
import { guardMgmt } from './guard.service';
import * as s from './guard.schema';

export const guardMgmtRouter = new ModuleRouter('/api/v1/admin/guards', {
  tag: 'Society Admin - Security Staff',
  tagDescription: 'Register and manage security guards and their gate assignments',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
});
const permissions = [P.GUARD_MANAGE];
guardMgmtRouter
  .add({ method: 'get', path: '/', summary: 'List guards', permissions, query: s.guardQuery, response: s.guardItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await guardMgmt.list(req.auth.societyId!, req.valid.query)) })
  .add({ method: 'post', path: '/', summary: 'Register a guard and assign a gate', permissions, body: s.createGuardBody, response: s.guardItem, status: 201, errors: [404, 409], handler: async (req: Request, res: Response) => created(res, await guardMgmt.create(req.auth.societyId!, req.auth.userId, req.valid.body), 'Guard registered') })
  .add({ method: 'get', path: '/:id', summary: 'Get guard', permissions, params: idParam, response: s.guardItem, handler: async (req: Request, res: Response) => ok(res, await guardMgmt.get(req.auth.societyId!, req.valid.params.id)) })
  .add({ method: 'patch', path: '/:id', summary: 'Update guard assignment or status', permissions, params: idParam, body: s.updateGuardBody, response: s.guardItem, handler: async (req: Request, res: Response) => ok(res, await guardMgmt.update(req.auth.societyId!, req.valid.params.id, req.auth.userId, req.valid.body), 'Guard updated') })
  .add({ method: 'delete', path: '/:id', summary: 'Remove guard and revoke sessions', permissions, params: idParam, response: null, handler: async (req: Request, res: Response) => {
    await guardMgmt.remove(req.auth.societyId!, req.valid.params.id, req.auth.userId);
    ok(res, null, 'Guard removed');
  } });
