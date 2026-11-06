import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { idParam } from '../../common/validators/common';
import { authLimiter } from '../../middleware/rateLimit.middleware';
import * as c from './society.controller';
import * as s from './society.schema';

export const superSocietyRouter = new ModuleRouter('/api/v1/super-admin/societies', {
  tag: 'Super Admin - Societies',
  tagDescription: 'Platform-level society lifecycle, entitlements, subscription plans and audited impersonation',
  roles: [UserType.SUPER_ADMIN],
});

superSocietyRouter
  .add({ method: 'get', path: '/', summary: 'List societies', description: 'Filter by status (PENDING shows registrations awaiting approval), organization and type.', query: s.societyListQuery, response: s.societyItem, paginated: true, handler: c.superSocietyController.list })
  .add({ method: 'post', path: '/', summary: 'Create society with its primary administrator', description: 'Atomically creates the society, seeds its role set from the global role templates and provisions the primary admin (must change password on first login).', body: s.createSocietyBody, response: s.societyItem, status: 201, errors: [409], handler: c.superSocietyController.create })
  .add({ method: 'get', path: '/:id', summary: 'Get society details', params: idParam, response: s.societyItem, handler: c.superSocietyController.get })
  .add({ method: 'patch', path: '/:id', summary: 'Update society', params: idParam, body: s.updateSocietyBody, response: s.societyItem, handler: c.superSocietyController.update })
  .add({ method: 'delete', path: '/:id', summary: 'Delete society (soft)', params: idParam, response: null, handler: c.superSocietyController.remove })
  .add({ method: 'post', path: '/:id/activate', summary: 'Activate or approve a society', params: idParam, body: s.statusBody, response: s.societyItem, status: 200, errors: [409], handler: c.superSocietyController.activate })
  .add({ method: 'post', path: '/:id/deactivate', summary: 'Deactivate a society', description: 'All users of the society lose access immediately.', params: idParam, body: s.statusBody, response: s.societyItem, status: 200, errors: [409], handler: c.superSocietyController.deactivate })
  .add({ method: 'put', path: '/:id/features', summary: 'Set module entitlements', params: idParam, body: s.featuresBody, response: s.societyItem, handler: c.superSocietyController.features })
  .add({ method: 'put', path: '/:id/plan', summary: 'Assign subscription plan', params: idParam, body: s.planBody, response: s.societyItem, handler: c.superSocietyController.plan })
  .add({ method: 'post', path: '/:id/impersonate', summary: 'Start audited impersonation of a society admin dashboard', description: 'Requires a written reason. Returns a short-lived admin token. Every request made with it is written to the immutable audit log with the impersonation session id.', params: idParam, body: s.impersonationBody, response: s.impersonationResponse, status: 201, handler: c.superSocietyController.impersonate });

export const impersonationRouter = new ModuleRouter('/api/v1/super-admin/impersonations', { tag: 'Super Admin - Societies', roles: [UserType.SUPER_ADMIN] });
impersonationRouter.add({ method: 'post', path: '/:id/end', summary: 'End an impersonation session', params: idParam, response: null, status: 200, handler: c.superSocietyController.endImpersonation });

export const societyPublicRouter = new ModuleRouter('/api/v1/auth/societies', { tag: 'Authentication', roles: [UserType.RESIDENT] });
societyPublicRouter.add({ method: 'post', path: '/register', public: true, limiter: authLimiter, summary: 'Submit a society registration request', description: 'Creates a PENDING society awaiting platform approval.', body: s.registerSocietyBody, response: s.societyItem, status: 201, errors: [409, 429], handler: c.superSocietyController.registerPublic });

export const adminStructureRouter = new ModuleRouter('/api/v1/admin', {
  tag: 'Society Admin - Society Setup',
  tagDescription: 'Society profile, rules, visitor policy, towers, blocks, floors, flats and gates',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
});

adminStructureRouter
  .add({ method: 'get', path: '/society', summary: 'Get my society configuration', permissions: [P.SOCIETY_READ], response: s.societyItem, handler: c.adminSocietyController.get })
  .add({ method: 'patch', path: '/society', summary: 'Update society details, rules, hours, holidays, policies and module toggles', description: 'Module toggles can only turn off modules; modules not entitled by the platform stay disabled.', permissions: [P.SOCIETY_UPDATE], body: s.adminSocietyUpdateBody, response: s.societyItem, handler: c.adminSocietyController.update })
  .add({ method: 'post', path: '/flats/bulk', summary: 'Bulk-generate flats for a tower', description: 'Creates unitsPerFloor flats for every floor in the range. Existing labels are skipped.', permissions: [P.STRUCTURE_MANAGE], body: s.bulkFlatsBody, response: s.bulkFlatsResponse, status: 201, handler: c.adminSocietyController.bulkFlats });

crudRoutes(adminStructureRouter, { path: '/blocks', name: 'Block', controller: c.blockController, create: s.blockBody, query: s.blockQuery, item: s.blockItem, read: [P.SOCIETY_READ], write: [P.STRUCTURE_MANAGE] });
crudRoutes(adminStructureRouter, { path: '/towers', name: 'Tower', controller: c.towerController, create: s.towerBody, query: s.towerQuery, item: s.towerItem, read: [P.SOCIETY_READ], write: [P.STRUCTURE_MANAGE] });
crudRoutes(adminStructureRouter, { path: '/floors', name: 'Floor', controller: c.floorController, create: s.floorBody, query: s.floorQuery, item: s.floorItem, read: [P.SOCIETY_READ], write: [P.STRUCTURE_MANAGE] });
crudRoutes(adminStructureRouter, { path: '/flats', name: 'Flat', controller: c.flatController, create: s.flatBody, query: s.flatQuery, item: s.flatItem, read: [P.SOCIETY_READ], write: [P.STRUCTURE_MANAGE] });
crudRoutes(adminStructureRouter, { path: '/gates', name: 'Gate', controller: c.gateController, create: s.gateBody, query: s.gateQuery, item: s.gateItem, read: [P.SOCIETY_READ], write: [P.STRUCTURE_MANAGE] });

