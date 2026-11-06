import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { idParam } from '../../common/validators/common';
import * as c from './roles.controller';
import * as s from './roles.schema';

export const rolesRouter = new ModuleRouter('/api/v1/admin', {
  tag: 'Society Admin - Roles & Permissions',
  tagDescription: 'Configurable administrative sub-roles (Community Admin, Society Manager, Security Admin, Helpdesk, Accountant, Facility, Maintenance, Custom)',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
});

rolesRouter.add({ method: 'get', path: '/permissions', summary: 'Permission catalog', permissions: [P.ROLE_MANAGE], response: s.permissionCatalog, handler: c.permissionCatalogHandler });
crudRoutes(rolesRouter, { path: '/roles', name: 'Role', controller: c.roleController, create: s.roleBody, query: s.roleQuery, item: s.roleItem, read: [P.ROLE_MANAGE], write: [P.ROLE_MANAGE] });

export const globalRolesRouter = new ModuleRouter('/api/v1/super-admin/role-templates', {
  tag: 'Super Admin - Security',
  tagDescription: 'Global role templates, login history, suspicious activity, access restrictions and the audit trail',
  roles: [UserType.SUPER_ADMIN],
});
globalRolesRouter
  .add({ method: 'get', path: '/', summary: 'List global role templates', description: 'Templates are copied into every newly created society.', response: z.array(s.templateItem), handler: c.globalRoleController.list })
  .add({ method: 'post', path: '/', summary: 'Create role template', body: s.templateBody, response: s.templateItem, status: 200, handler: c.globalRoleController.create })
  .add({ method: 'patch', path: '/:id', summary: 'Update role template', params: idParam, body: s.templateBody.partial(), response: s.templateItem, handler: c.globalRoleController.update })
  .add({ method: 'delete', path: '/:id', summary: 'Delete role template', params: idParam, response: null, handler: c.globalRoleController.remove });
