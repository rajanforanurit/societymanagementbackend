import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { ok } from '../../common/responses/respond';
import { ApiError } from '../../common/utils/apiError';
import { idParam } from '../../common/validators/common';
import { FlatStatus, vals } from '../../common/constants/enums';
import { authLimiter } from '../../middleware/rateLimit.middleware';
import * as c from './society.controller';
import * as s from './society.schema';
import { Flat, Society } from './society.model';

export const superSocietyRouter = new ModuleRouter('/api/v1/super-admin/societies', {
  tag: 'Super Admin - Societies',
  tagDescription: 'Platform-level society lifecycle, entitlements, subscription plans and audited impersonation',
  roles: [UserType.SUPER_ADMIN],
});

superSocietyRouter
  .add({ method: 'get', path: '/', summary: 'List societies', description: 'Filter by status (PENDING shows registrations awaiting approval), organization and type.', query: s.societyListQuery, response: s.societyItem, paginated: true, handler: c.superSocietyController.list })
  .add({ method: 'post', path: '/', summary: 'Create society with its primary administrator', description: 'The society code is generated (DDMM + initials + YY, e.g. 1811ROR26; a numeric suffix is added on a collision). Choose MULTIFAMILY (towers, floors and units per floor) or SINGLE_FAMILY (houses); the tower/floor/flat records are generated from the layout. Atomically creates the society, seeds its role set from the global role templates and provisions the primary admin (must change password on first login).', body: s.createSocietyBody, response: s.societyItem, status: 201, errors: [409], handler: c.superSocietyController.create })
  .add({ method: 'get', path: '/:id', summary: 'Get society details', params: idParam, response: s.societyItem, handler: c.superSocietyController.get })
  .add({ method: 'get', path: '/:id/administration', summary: 'Administration details of a society', description: 'Primary and additional administrators (name, mobile, email, role, status, last sign-in), who created/approved the society and when, and the original applicant if it registered itself.', params: idParam, response: s.administrationItem, errors: [404], handler: c.superSocietyController.administration })
  .add({ method: 'patch', path: '/:id', summary: 'Update society', params: idParam, body: s.updateSocietyBody, response: s.societyItem, handler: c.superSocietyController.update })
  .add({ method: 'delete', path: '/:id', summary: 'Delete society (soft)', params: idParam, response: null, handler: c.superSocietyController.remove })
  .add({ method: 'post', path: '/:id/approve', summary: 'Verify a pending society registration and create its administrator', description: 'Seeds the society roles, creates the primary administrator (mobile + password; defaults to the applicant details; must change the password at first login), stores the floor plan / property details and hospitals, and activates the society. The administrator receives an in-app notification.', params: idParam, body: s.approveRegistrationBody, response: s.societyItem, status: 200, errors: [400, 409], handler: c.superSocietyController.approveRegistration })
  .add({ method: 'post', path: '/:id/reject', summary: 'Reject a pending society registration', params: idParam, body: s.rejectRegistrationBody, response: s.societyItem, status: 200, errors: [409], handler: c.superSocietyController.rejectRegistration })
  .add({ method: 'put', path: '/:id/property-info', summary: 'Set floor plan / property details and hospitals (Super Admin only)', description: 'Society admins cannot change these. Send propertyDetails and/or hospitals; each supplied part is replaced as a whole.', params: idParam, body: s.propertyInfoBody, response: s.societyItem, errors: [404], handler: c.superSocietyController.propertyInfo })
  .add({ method: 'post', path: '/:id/activate', summary: 'Activate or approve a society', params: idParam, body: s.statusBody, response: s.societyItem, status: 200, errors: [409], handler: c.superSocietyController.activate })
  .add({ method: 'post', path: '/:id/deactivate', summary: 'Deactivate a society', description: 'All users of the society lose access immediately.', params: idParam, body: s.statusBody, response: s.societyItem, status: 200, errors: [409], handler: c.superSocietyController.deactivate })
  .add({ method: 'put', path: '/:id/features', summary: 'Set module entitlements', params: idParam, body: s.featuresBody, response: s.societyItem, handler: c.superSocietyController.features })
  .add({ method: 'put', path: '/:id/plan', summary: 'Assign subscription plan', params: idParam, body: s.planBody, response: s.societyItem, handler: c.superSocietyController.plan })
  .add({ method: 'post', path: '/:id/impersonate', summary: 'Start audited impersonation of a society admin dashboard', description: 'Requires a written reason. Returns a short-lived admin token. Every request made with it is written to the immutable audit log with the impersonation session id.', params: idParam, body: s.impersonationBody, response: s.impersonationResponse, status: 201, handler: c.superSocietyController.impersonate });

export const impersonationRouter = new ModuleRouter('/api/v1/super-admin/impersonations', { tag: 'Super Admin - Societies', roles: [UserType.SUPER_ADMIN] });
impersonationRouter.add({ method: 'post', path: '/:id/end', summary: 'End an impersonation session', params: idParam, response: null, status: 200, handler: c.superSocietyController.endImpersonation });

export const societyPublicRouter = new ModuleRouter('/api/v1/auth/societies', { tag: 'Authentication', roles: [UserType.RESIDENT] });
societyPublicRouter.add({ method: 'post', path: '/register', public: true, limiter: authLimiter, summary: 'Submit a society registration request', description: 'Creates a PENDING society awaiting platform approval.', body: s.registerSocietyBody, response: s.societyItem, status: 201, errors: [409, 429], handler: c.superSocietyController.registerPublic });
// Flats of an ACTIVE society, so a resident can pick the right unit when
// applying. Any signed-in role may read this before joining (the membership
// request needs a real flatId). The tenant middleware is bypassed via
// skipTenantCheck: the societyId comes from the URL, not the auth context.
societyPublicRouter.add({ method: 'get', path: '/:id/flats', summary: "List an active society's flats (for the join flow)", description: 'Returns the flats of an ACTIVE society so a resident can select their unit when applying. Any authenticated role can read this before joining.', params: idParam, response: z.array(s.flatItem), handler: async (req: Request, res: Response) => {
  // Only ACTIVE societies are joinable; never reveal another society's structure.
  if (!(await Society.exists({ _id: req.valid.params.id, status: 'ACTIVE' }))) throw ApiError.notFound('Society not found');
  const flats = await Flat.find({ societyId: req.valid.params.id, isDeleted: { $ne: true } }, undefined, { skipTenantCheck: true } as any).select('label unitNumber floorNumber status').sort({ label: 1 }).limit(200);
  ok(res, flats);
} });

export const adminStructureRouter = new ModuleRouter('/api/v1/admin', {
  tag: 'Society Admin - Society Setup',
  tagDescription: 'Operating settings and gates; the society profile and its towers, blocks, floors and flats are read-only (owned by the Super Admin)',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
});

adminStructureRouter
  .add({ method: 'get', path: '/society', summary: 'Get my society configuration', permissions: [P.SOCIETY_READ], response: s.societyItem, handler: c.adminSocietyController.get })
  .add({ method: 'patch', path: '/society', summary: 'Update operating settings: rules, hours, holidays, visitor policy, finance and module toggles', description: 'Name, address, contact and property structure belong to the Super Admin and are not accepted here. Module toggles can only turn off modules; modules not entitled by the platform stay disabled.', permissions: [P.SOCIETY_UPDATE], body: s.adminSocietyUpdateBody, response: s.societyItem, handler: c.adminSocietyController.update });

// Blocks, towers, floors and flats are generated from the layout the Super Admin configures: read-only here.
crudRoutes(adminStructureRouter, { path: '/blocks', name: 'Block', controller: c.blockController, query: s.blockQuery, item: s.blockItem, read: [P.SOCIETY_READ] });
crudRoutes(adminStructureRouter, { path: '/towers', name: 'Tower', controller: c.towerController, query: s.towerQuery, item: s.towerItem, read: [P.SOCIETY_READ] });
crudRoutes(adminStructureRouter, { path: '/floors', name: 'Floor', controller: c.floorController, query: s.floorQuery, item: s.floorItem, read: [P.SOCIETY_READ] });
crudRoutes(adminStructureRouter, { path: '/flats', name: 'Flat', controller: c.flatController, query: s.flatQuery, item: s.flatItem, read: [P.SOCIETY_READ] });
crudRoutes(adminStructureRouter, { path: '/gates', name: 'Gate', controller: c.gateController, create: s.gateBody, query: s.gateQuery, item: s.gateItem, read: [P.SOCIETY_READ], write: [P.STRUCTURE_MANAGE] });


const infoRoute = { summary: 'Floor plan / property details and hospitals of my society', description: 'Configured by the platform team (Super Admin). Read-only.', response: s.propertyInfoItem, handler: c.propertyInfoController.mine };
export const propertyInfoResidentRouter = new ModuleRouter('/api/v1/user/society-info', { tag: 'Resident - Society Info', roles: [UserType.RESIDENT], societyScoped: true });
propertyInfoResidentRouter.add({ method: 'get', path: '/', ...infoRoute });
export const propertyInfoGuardRouter = new ModuleRouter('/api/v1/guard/society-info', { tag: 'Guard', roles: [UserType.GUARD], societyScoped: true });
propertyInfoGuardRouter.add({ method: 'get', path: '/', ...infoRoute });
