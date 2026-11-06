import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { idParam } from '../../common/validators/common';
import * as c from './resident.controller';
import * as s from './resident.schema';

export const residentAdminRouter = new ModuleRouter('/api/v1/admin/residents', {
  tag: 'Society Admin - Residents',
  tagDescription: 'Approve registrations, verify ownership/tenancy, assign flats and manage resident access',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
});
const a = c.residentAdminController;
residentAdminRouter
  .add({ method: 'get', path: '/', summary: 'List residents', description: 'Filter by status=PENDING for the registration queue.', permissions: [P.RESIDENT_READ], query: s.residentQuery, response: s.residentItem, paginated: true, handler: a.list })
  .add({ method: 'get', path: '/:id', summary: 'Get resident', permissions: [P.RESIDENT_READ], params: idParam, response: s.residentItem, handler: a.get })
  .add({ method: 'post', path: '/:id/approve', summary: 'Approve resident registration', description: 'Atomically approves, marks the flat occupied and assigns primary-resident status if the flat has none.', permissions: [P.RESIDENT_APPROVE], params: idParam, response: s.residentItem, status: 200, errors: [409], handler: a.approve })
  .add({ method: 'post', path: '/:id/reject', summary: 'Reject resident registration', permissions: [P.RESIDENT_APPROVE], params: idParam, body: s.rejectBody, response: s.residentItem, status: 200, errors: [409], handler: a.reject })
  .add({ method: 'post', path: '/:id/activate', summary: 'Re-activate resident', permissions: [P.RESIDENT_MANAGE], params: idParam, response: s.residentItem, status: 200, errors: [409], handler: a.activate })
  .add({ method: 'post', path: '/:id/deactivate', summary: 'Deactivate resident account in this society', permissions: [P.RESIDENT_MANAGE], params: idParam, response: s.residentItem, status: 200, errors: [409], handler: a.deactivate })
  .add({ method: 'patch', path: '/:id', summary: 'Assign flat, type and resident-level permissions', permissions: [P.RESIDENT_MANAGE], params: idParam, body: s.adminResidentUpdate, response: s.residentItem, handler: a.update })
  .add({ method: 'post', path: '/:id/verification', summary: 'Record ownership / tenancy verification', permissions: [P.RESIDENT_APPROVE], params: idParam, body: s.verificationBody, response: s.residentItem, status: 200, handler: a.verify });

export const moveAdminRouter = new ModuleRouter('/api/v1/admin/move-requests', { tag: 'Society Admin - Residents', roles: [UserType.SOCIETY_ADMIN], societyScoped: true });
moveAdminRouter.add({ method: 'get', path: '/', summary: 'List move-in / move-out requests', description: 'Decisions are made through /api/v1/admin/approvals/{id}/approve|reject using the approval request of the move request.', permissions: [P.RESIDENT_MANAGE], query: s.moveQuery, response: s.moveItem, paginated: true, handler: a.moveRequests });

export const residentSelfRouter = new ModuleRouter('/api/v1/user', {
  tag: 'Resident - Profile & Membership',
  tagDescription: 'Profile, notification preferences, society membership requests, family and move requests',
  roles: [UserType.RESIDENT],
  societyScoped: false,
});
const r = c.residentSelfController;
residentSelfRouter
  .add({ method: 'get', path: '/profile', summary: 'Get my profile', response: s.profileItem, handler: r.profile })
  .add({ method: 'patch', path: '/profile', summary: 'Update my profile', body: s.profileUpdateBody, response: s.profileItem, errors: [409], handler: r.updateProfile })
  .add({ method: 'put', path: '/notification-preferences', summary: 'Manage notification preferences', body: s.notificationPrefsBody, response: s.profileItem, handler: r.prefs })
  .add({ method: 'post', path: '/society-requests', summary: 'Request society membership for a flat', description: 'Registers ownership or tenancy and submits verification documents (upload them first through /api/v1/files?societyId=...). The request is PENDING until a society admin approves it.', body: s.societyRequestBody, response: s.residentItem, status: 201, errors: [404, 409], handler: r.requestMembership })
  .add({ method: 'get', path: '/society-requests', summary: 'View my membership requests and approval status', response: z.array(s.residentItem), handler: r.mine })
  .add({ method: 'post', path: '/society-requests/:id/documents', summary: 'Attach a verification document to a pending request', params: idParam, body: s.addDocumentBody, response: s.residentItem, status: 200, handler: r.addDocument })
  .add({ method: 'delete', path: '/society-requests/:id', summary: 'Cancel a pending request', params: idParam, response: null, handler: r.cancel });

export const familyRouter = new ModuleRouter('/api/v1/user/family', { tag: 'Resident - Profile & Membership', roles: [UserType.RESIDENT], societyScoped: true });
crudRoutes(familyRouter, { path: '/', name: 'Family member', plural: 'Family members', controller: c.familyController, create: s.familyBody, query: s.familyQuery, item: s.familyItem });

export const moveSelfRouter = new ModuleRouter('/api/v1/user/move-requests', { tag: 'Resident - Profile & Membership', roles: [UserType.RESIDENT], societyScoped: true });
moveSelfRouter
  .add({ method: 'post', path: '/', summary: 'Submit move-in / move-out request (enters approval workflow)', body: s.moveBody, response: s.moveItem, status: 201, handler: c.moveController.create })
  .add({ method: 'get', path: '/', summary: 'List my move requests', query: s.moveQuery, response: s.moveItem, paginated: true, handler: c.moveController.list })
  .add({ method: 'get', path: '/:id', summary: 'Get my move request', params: idParam, response: s.moveItem, handler: c.moveController.get })
  .add({ method: 'post', path: '/:id/withdraw', summary: 'Withdraw a move request', params: idParam, response: s.moveItem, status: 200, errors: [409], handler: c.moveController.withdraw });
