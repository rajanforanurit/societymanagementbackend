import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { ApiError } from '../../common/utils/apiError';
import { objectId } from '../../common/validators/common';
import { Role } from '../roles/roles.model';
import { roleItem } from '../roles/roles.schema';
import * as st from '../staff/staff.schema';
import { staffExtra, vendorService } from '../staff/staff.service';
import { Society } from './society.model';

export const superSocietyMgmtRouter = new ModuleRouter('/api/v1/super-admin/societies', {
  tag: 'Super Admin - Society vendors & roles',
  tagDescription: 'Vendors of a society and the roles available to its administrators. Only the Super Admin can add or change vendors.',
  roles: [UserType.SUPER_ADMIN],
});

const societyParam = z.object({ societyId: objectId });
const vendorParam = z.object({ societyId: objectId, id: objectId });
const contractParam = z.object({ societyId: objectId, id: objectId, contractId: objectId });

const societyOf = async (req: Request) => {
  const societyId: string = req.valid.params.societyId;
  if (!(await Society.exists({ _id: societyId }))) throw ApiError.notFound('Society not found');
  return societyId;
};

superSocietyMgmtRouter
  .add({ method: 'get', path: '/:societyId/roles', summary: 'Roles of a society', description: 'The roles an administrator of this society can be given.', params: societyParam, response: z.array(roleItem), errors: [404], handler: async (req: Request, res: Response) => {
    const societyId = await societyOf(req);
    ok(res, await Role.find({ societyId }).sort({ isSystem: -1, name: 1 }));
  } })
  .add({ method: 'get', path: '/:societyId/vendors', summary: 'List vendors of a society', params: societyParam, query: st.vendorQuery, response: st.vendorItem, paginated: true, errors: [404], handler: async (req: Request, res: Response) => paged(res, await vendorService.list(await societyOf(req), req.valid.query)) })
  .add({ method: 'get', path: '/:societyId/vendors/:id', summary: 'Get a vendor', params: vendorParam, response: st.vendorItem, errors: [404], handler: async (req: Request, res: Response) => ok(res, await vendorService.get(await societyOf(req), req.valid.params.id)) })
  .add({ method: 'post', path: '/:societyId/vendors', summary: 'Add a vendor to a society', params: societyParam, body: st.vendorBody, response: st.vendorItem, status: 201, errors: [404, 409], handler: async (req: Request, res: Response) => created(res, await vendorService.create(await societyOf(req), req.auth.userId, req.valid.body), 'Vendor created') })
  .add({ method: 'patch', path: '/:societyId/vendors/:id', summary: 'Update a vendor', params: vendorParam, body: st.vendorBody.partial(), response: st.vendorItem, errors: [404, 409], handler: async (req: Request, res: Response) => ok(res, await vendorService.update(await societyOf(req), req.valid.params.id, req.auth.userId, req.valid.body), 'Vendor updated') })
  .add({ method: 'delete', path: '/:societyId/vendors/:id', summary: 'Delete a vendor (soft)', params: vendorParam, response: null, errors: [404, 409], handler: async (req: Request, res: Response) => {
    await vendorService.remove(await societyOf(req), req.valid.params.id, req.auth.userId);
    ok(res, null, 'Vendor deleted');
  } })
  .add({ method: 'post', path: '/:societyId/vendors/:id/contracts', summary: 'Add a vendor contract', params: vendorParam, body: st.contractBody, response: st.vendorItem, status: 201, errors: [404], handler: async (req: Request, res: Response) => created(res, await staffExtra.addContract(await societyOf(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Contract added') })
  .add({ method: 'delete', path: '/:societyId/vendors/:id/contracts/:contractId', summary: 'Remove a vendor contract', params: contractParam, response: st.vendorItem, errors: [404], handler: async (req: Request, res: Response) => ok(res, await staffExtra.removeContract(await societyOf(req), req.auth.userId, req.valid.params.id, req.valid.params.contractId), 'Contract removed') });
