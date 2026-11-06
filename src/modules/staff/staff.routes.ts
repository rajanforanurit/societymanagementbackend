import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { crudController } from '../../common/services/crud.controller';
import { dateOnly, idParam } from '../../common/validators/common';
import * as s from './staff.schema';
import { assetService, staffExtra as x, staffService, taskService, vendorService } from './staff.service';

const sid = (r: Request) => r.auth.societyId!;
export const staffAdminRouter = new ModuleRouter('/api/v1/admin', { tag: 'Society Admin - Staff & Vendors', roles: [UserType.SOCIETY_ADMIN], societyScoped: true });

crudRoutes(staffAdminRouter, { path: '/staff', name: 'Staff member', plural: 'Staff', controller: crudController(staffService, { label: 'Staff member', prepare: (_r, b) => x.normalize(b) }), create: s.staffBody, query: s.staffQuery, item: s.staffItem, read: [P.STAFF_MANAGE], write: [P.STAFF_MANAGE], feature: 'staff' });
const sm = [P.STAFF_MANAGE];
staffAdminRouter
  .add({ method: 'post', path: '/staff/:id/verify-documents', summary: 'Verify staff documents', permissions: sm, feature: 'staff', params: idParam, body: s.verifyDocsBody, response: s.staffItem, status: 200, handler: async (req: Request, res: Response) => ok(res, await x.verifyDocs(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Documents updated') })
  .add({ method: 'put', path: '/staff/:id/attendance', summary: 'Record staff attendance for a date', permissions: sm, feature: 'staff', params: idParam, body: s.attendanceBody, response: s.attendanceItem, handler: async (req: Request, res: Response) => ok(res, await x.markAttendance(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Attendance recorded') })
  .add({ method: 'get', path: '/staff/:id/attendance', summary: 'Staff attendance history', permissions: sm, feature: 'staff', params: idParam, query: s.attendanceQuery, response: s.attendanceItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await x.attendance(sid(req), req.valid.params.id, req.valid.query)) })
  .add({ method: 'get', path: '/staff/:id/performance', summary: 'Staff performance: attendance, tasks and complaint resolution', permissions: sm, feature: 'staff', params: idParam, query: z.object({ from: dateOnly.optional(), to: dateOnly.optional() }), response: s.performanceItem, handler: async (req: Request, res: Response) => ok(res, await x.performance(sid(req), req.valid.params.id, req.valid.query)) });

crudRoutes(staffAdminRouter, { path: '/vendors', name: 'Vendor', controller: crudController(vendorService, { label: 'Vendor' }), create: s.vendorBody, query: s.vendorQuery, item: s.vendorItem, read: [P.VENDOR_MANAGE], write: [P.VENDOR_MANAGE], feature: 'staff' });
staffAdminRouter
  .add({ method: 'post', path: '/vendors/:id/contracts', summary: 'Add a vendor contract', permissions: [P.VENDOR_MANAGE], feature: 'staff', params: idParam, body: s.contractBody, response: s.vendorItem, status: 201, handler: async (req: Request, res: Response) => created(res, await x.addContract(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Contract added') })
  .add({ method: 'delete', path: '/vendors/:id/contracts/:contractId', summary: 'Remove a vendor contract', permissions: [P.VENDOR_MANAGE], feature: 'staff', params: z.object({ id: idParam.shape.id, contractId: idParam.shape.id }), response: s.vendorItem, handler: async (req: Request, res: Response) => ok(res, await x.removeContract(sid(req), req.auth.userId, req.valid.params.id, req.valid.params.contractId), 'Contract removed') });

crudRoutes(staffAdminRouter, { path: '/tasks', name: 'Task', controller: { ...crudController(taskService, { label: 'Task' }), update: async (req: Request, res: Response) => ok(res, await x.updateTask(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Task updated') }, create: s.taskBody, update: s.taskUpdate, query: s.taskQuery, item: s.taskItem, read: [P.TASK_MANAGE], write: [P.TASK_MANAGE] });
crudRoutes(staffAdminRouter, { path: '/assets', name: 'Asset', controller: crudController(assetService, { label: 'Asset' }), create: s.assetBody, query: s.assetQuery, item: s.assetItem, read: [P.ASSET_MANAGE], write: [P.ASSET_MANAGE], feature: 'assets' });
staffAdminRouter.add({ method: 'get', path: '/inventory/low-stock', summary: 'Inventory items at or below their minimum quantity', permissions: [P.ASSET_MANAGE], feature: 'assets', response: z.array(s.lowStockItem), handler: async (req: Request, res: Response) => ok(res, await x.lowStock(sid(req))) });
