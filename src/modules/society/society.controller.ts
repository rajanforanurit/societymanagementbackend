import { Request, Response } from 'express';
import { crudController } from '../../common/services/crud.controller';
import { created, ok, paged } from '../../common/responses/respond';
import { User } from '../auth/auth.model';
import * as svc from './society.service';

export const superSocietyController = {
  list: async (req: Request, res: Response) => paged(res, await svc.societyAdminService.list(req.valid.query)),
  get: async (req: Request, res: Response) => ok(res, await svc.societyAdminService.get(req.valid.params.id)),
  create: async (req: Request, res: Response) => created(res, await svc.societyAdminService.create(req.valid.body, req.auth.userId), 'Society created'),
  update: async (req: Request, res: Response) => ok(res, await svc.societyAdminService.update(req.valid.params.id, req.valid.body, req.auth.userId), 'Society updated'),
  activate: async (req: Request, res: Response) => ok(res, await svc.societyAdminService.setStatus(req.valid.params.id, 'ACTIVE', req.valid.body.reason, req.auth.userId), 'Society activated'),
  deactivate: async (req: Request, res: Response) => ok(res, await svc.societyAdminService.setStatus(req.valid.params.id, 'INACTIVE', req.valid.body.reason, req.auth.userId), 'Society deactivated'),
  remove: async (req: Request, res: Response) => {
    await svc.societyAdminService.remove(req.valid.params.id, req.auth.userId);
    ok(res, null, 'Society deleted');
  },
  features: async (req: Request, res: Response) => ok(res, await svc.societyAdminService.setFeatures(req.valid.params.id, req.valid.body.features, req.auth.userId), 'Features updated'),
  plan: async (req: Request, res: Response) => ok(res, await svc.societyAdminService.setPlan(req.valid.params.id, req.valid.body, req.auth.userId), 'Plan assigned'),
  impersonate: async (req: Request, res: Response) => {
    const u: any = await User.findById(req.auth.userId).select('+tokenVersion');
    created(res, await svc.societyAdminService.impersonate(req.valid.params.id, req.valid.body, { userId: req.auth.userId, tv: u.tokenVersion ?? 0, ip: req.ip }), 'Impersonation session started');
  },
  endImpersonation: async (req: Request, res: Response) => {
    await svc.societyAdminService.endImpersonation(req.valid.params.id, req.auth.userId);
    ok(res, null, 'Impersonation session ended');
  },
  registerPublic: async (req: Request, res: Response) => created(res, await svc.societyAdminService.registerPublic(req.valid.body), 'Registration submitted for review'),
};

export const adminSocietyController = {
  get: async (req: Request, res: Response) => ok(res, await svc.societyMineService.get(req.auth.societyId!)),
  update: async (req: Request, res: Response) => ok(res, await svc.societyMineService.update(req.auth.societyId!, req.valid.body, req.auth.userId), 'Society updated'),
  bulkFlats: async (req: Request, res: Response) => created(res, await svc.bulkCreateFlats(req.auth.societyId!, req.auth.userId, req.valid.body), 'Flats generated'),
};

export const blockController = crudController(svc.blockService, { label: 'Block' });
export const towerController = crudController(svc.towerService, { label: 'Tower' });
export const floorController = crudController(svc.floorService, { label: 'Floor' });
export const flatController = crudController(svc.flatService, { label: 'Flat' });
export const gateController = crudController(svc.gateService, { label: 'Gate' });
