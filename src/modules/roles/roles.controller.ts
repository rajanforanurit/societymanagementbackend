import { Request, Response } from 'express';
import { ALL_PERMISSIONS } from '../../common/constants/permissions';
import { ApiError } from '../../common/utils/apiError';
import { ok } from '../../common/responses/respond';
import { crudController } from '../../common/services/crud.controller';
import { globalRoleService, roleService } from './roles.service';
import { Role } from './roles.model';

export const roleController = {
  ...crudController(roleService, { label: 'Role', prepare: (_r, b) => ({ ...b, isSystem: false }) }),
  update: async (req: Request, res: Response) => {
    const role: any = await Role.findOne({ _id: req.valid.params.id, societyId: req.auth.societyId });
    if (!role) throw ApiError.notFound('Role not found');
    if (role.isSystem && (req.valid.body.key || req.valid.body.name)) throw ApiError.conflict('System role identity cannot be changed; adjust permissions only', 'SYSTEM_ROLE');
    ok(res, await roleService.update(req.auth.societyId!, req.valid.params.id, req.auth.userId, req.valid.body), 'Role updated');
  },
};

export const permissionCatalogHandler = async (_req: Request, res: Response) =>
  ok(res, ALL_PERMISSIONS.map((p) => ({ key: p, resource: p.split(':')[0], action: p.split(':')[1] })));

export const globalRoleController = {
  list: async (req: Request, res: Response) => {
    const r = await globalRoleService.model.find({}).sort({ name: 1 });
    ok(res, r);
  },
  create: async (req: Request, res: Response) => ok(res, await globalRoleService.model.create(req.valid.body), 'Role template created'),
  update: async (req: Request, res: Response) => {
    const t = await globalRoleService.model.findByIdAndUpdate(req.valid.params.id, { $set: req.valid.body }, { new: true, runValidators: true });
    if (!t) throw ApiError.notFound('Role template not found');
    ok(res, t, 'Role template updated');
  },
  remove: async (req: Request, res: Response) => {
    await globalRoleService.model.findByIdAndUpdate(req.valid.params.id, { $set: { isDeleted: true, isActive: false } });
    ok(res, null, 'Role template deleted');
  },
};
