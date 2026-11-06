import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { crudController } from '../../common/services/crud.controller';
import { idParam, listQuery } from '../../common/validators/common';
import * as s from './domestic.schema';
import { domesticAdminService, domesticService as d, listReviews, providerService, reviewHelper, reviewProvider } from './domestic.service';

const sid = (r: Request) => r.auth.societyId!;

export const domesticResidentRouter = new ModuleRouter('/api/v1/user', {
  tag: 'Resident - Domestic Help & Services',
  tagDescription: 'Register and manage domestic help, attendance, payments, and find verified local service providers',
  roles: [UserType.RESIDENT],
  societyScoped: true,
  feature: 'domesticHelp',
});
domesticResidentRouter
  .add({ method: 'post', path: '/domestic-help', summary: 'Register a domestic worker', description: 'Starts in PENDING_VERIFICATION. A 6-digit entry code is generated for the gate.', body: s.registerHelpBody, response: s.helpItem, status: 201, errors: [409], handler: async (req: Request, res: Response) => created(res, await d.register(sid(req), req.auth.userId, req.auth.residents, req.valid.body), 'Domestic help registered') })
  .add({ method: 'get', path: '/domestic-help', summary: 'My domestic help', query: s.helpQuery, response: s.helpItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await d.mine(sid(req), req.auth.flatIds, req.valid.query)) })
  .add({ method: 'get', path: '/domestic-help/directory', summary: 'Search verified maids, drivers, cooks and cleaners', query: s.directoryQuery, response: s.helpDirectoryItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await d.directory(sid(req), req.valid.query)) })
  .add({ method: 'post', path: '/domestic-help/:id/hire', summary: 'Add a verified helper to my flat', params: idParam, body: s.hireBody, response: s.helpItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await d.hire(sid(req), req.auth.residents, req.valid.params.id, req.valid.body), 'Helper added') })
  .add({ method: 'post', path: '/domestic-help/:id/release', summary: 'Remove a helper from my flat', params: idParam, body: z.object({ flatId: s.hireBody.shape.flatId }), response: s.helpItem, status: 200, handler: async (req: Request, res: Response) => ok(res, await d.release(sid(req), req.auth.residents, req.valid.params.id, req.valid.body.flatId), 'Helper removed') })
  .add({ method: 'put', path: '/domestic-help/:id/attendance', summary: 'Mark daily attendance for my flat', params: idParam, body: s.attendanceBody, response: s.attendanceItem, handler: async (req: Request, res: Response) => ok(res, await d.mark(sid(req), req.auth.userId, req.auth.residents, req.valid.params.id, req.valid.body), 'Attendance recorded') })
  .add({ method: 'get', path: '/domestic-help/:id/attendance', summary: 'Attendance history (gate entries and my flat marks)', params: idParam, query: s.attendanceQuery, response: s.attendanceItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await d.attendance(sid(req), req.auth.flatIds, req.valid.params.id, req.valid.query)) })
  .add({ method: 'post', path: '/domestic-help/:id/payments', summary: 'Record a salary, advance or bonus payment', params: idParam, body: s.paymentBody, response: s.paymentItem, status: 201, handler: async (req: Request, res: Response) => created(res, await d.pay(sid(req), req.auth.userId, req.auth.residents, req.valid.params.id, req.valid.body), 'Payment recorded') })
  .add({ method: 'get', path: '/domestic-help/:id/payments', summary: 'Payment and advance history', params: idParam, query: s.paymentQuery, response: s.paymentItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await d.payments(sid(req), req.auth.flatIds, req.valid.params.id, req.valid.query)) })
  .add({ method: 'post', path: '/domestic-help/:id/reviews', summary: 'Rate a domestic helper', params: idParam, body: s.reviewBody, response: s.reviewItem, status: 201, handler: async (req: Request, res: Response) => created(res, await reviewHelper(sid(req), req.auth.userId, req.auth.flatIds, req.valid.params.id, req.valid.body), 'Review saved') })
  .add({ method: 'get', path: '/service-providers', summary: 'Find electricians, plumbers, carpenters and other professionals', query: s.providerQuery, response: s.providerItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await providerService.list(sid(req), req.valid.query, { status: 'ACTIVE' })) })
  .add({ method: 'get', path: '/service-providers/:id/reviews', summary: 'Reviews for a service provider', params: idParam, query: listQuery, response: s.reviewItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await listReviews(sid(req), req.valid.params.id, req.valid.query)) })
  .add({ method: 'post', path: '/service-providers/:id/reviews', summary: 'Rate and review a service provider', params: idParam, body: s.reviewBody, response: s.reviewItem, status: 201, handler: async (req: Request, res: Response) => created(res, await reviewProvider(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Review saved') });

export const domesticAdminRouter = new ModuleRouter('/api/v1/admin', {
  tag: 'Society Admin - Staff & Vendors',
  tagDescription: 'Domestic help verification, staff, vendors, service providers, attendance and contracts',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
});
domesticAdminRouter
  .add({ method: 'get', path: '/domestic-help', summary: 'List all domestic help in the society', permissions: [P.DOMESTIC_HELP_MANAGE], feature: 'domesticHelp', query: s.helpQuery, response: s.helpItem.omit({ code: true }), paginated: true, handler: async (req: Request, res: Response) => paged(res, await domesticAdminService.list(sid(req), req.valid.query)) })
  .add({ method: 'post', path: '/domestic-help/:id/review', summary: 'Verify, reject or suspend a domestic worker', permissions: [P.DOMESTIC_HELP_MANAGE], feature: 'domesticHelp', params: idParam, body: s.verifyHelpBody, response: s.helpItem, status: 200, handler: async (req: Request, res: Response) => ok(res, await d.review(sid(req), req.valid.params.id, req.valid.body.decision, req.valid.body.reason, req.auth.userId), 'Review saved') });
crudRoutes(domesticAdminRouter, { path: '/service-providers', name: 'Service provider', controller: crudController(providerService, { label: 'Service provider' }), create: s.providerBody, query: s.providerQuery, item: s.providerItem, read: [P.VENDOR_MANAGE], write: [P.VENDOR_MANAGE], feature: 'domesticHelp' });
