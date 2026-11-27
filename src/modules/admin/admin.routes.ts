import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { ModuleRouter } from '../../common/openapi/router';
import { idParam } from '../../common/validators/common';
import { activityItem, adminItem, adminQuery, permissionsBody, resetAccessResponse, superAdminQuery, superCreateAdminBody, updateAdminBody } from './admin.schema';
import { adminMgmtController as a, superAdminMgmtController as sa } from './admin.controller';
import { listQuery } from '../../common/validators/common';

export const adminMgmtRouter = new ModuleRouter('/api/v1/admin/admins', {
  tag: 'Society Admin - Administrators',
  tagDescription: 'Administrators of the current society (read-only; the Super Admin manages them)',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
});
const perm = [P.ADMIN_MANAGE];
adminMgmtRouter
  .add({ method: 'get', path: '/', summary: 'List administrators', permissions: perm, query: adminQuery, response: adminItem, paginated: true, handler: a.list })
  .add({ method: 'get', path: '/:id', summary: 'Get administrator', permissions: perm, params: idParam, response: adminItem, handler: a.get });

export const superAdminMgmtRouter = new ModuleRouter('/api/v1/super-admin/admins', {
  tag: 'Super Admin - Administrators',
  tagDescription: 'Platform-wide administrator management, permission assignment and activity monitoring',
  roles: [UserType.SUPER_ADMIN],
});
superAdminMgmtRouter
  .add({ method: 'get', path: '/', summary: 'List administrators across societies', query: superAdminQuery, response: adminItem, paginated: true, handler: sa.list })
  .add({ method: 'post', path: '/', summary: 'Create an administrator for a society', body: superCreateAdminBody, response: adminItem, status: 201, errors: [404, 409], handler: sa.create })
  .add({ method: 'patch', path: '/:id', summary: 'Update administrator role, designation or status', params: idParam, body: updateAdminBody, response: adminItem, handler: sa.update })
  .add({ method: 'put', path: '/:id/permissions', summary: 'Assign or revoke permissions', params: idParam, body: permissionsBody, response: adminItem, handler: sa.permissions })
  .add({ method: 'post', path: '/:id/reset-access', summary: 'Reset administrator access', params: idParam, response: resetAccessResponse, status: 200, handler: sa.resetAccess })
  .add({ method: 'get', path: '/:id/activity', summary: 'Administrator activity and approval history from the audit log', params: idParam, query: listQuery, response: activityItem, paginated: true, handler: sa.activity });
