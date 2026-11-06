import { Request, Response } from 'express';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { ApiError } from '../../common/utils/apiError';
import { crudController } from '../../common/services/crud.controller';
import { idParam } from '../../common/validators/common';
import * as s from './vehicle.schema';
import { parkingService as p, slotService, vehicleService } from './vehicle.service';

const sid = (r: Request) => r.auth.societyId!;

export const vehicleResidentRouter = new ModuleRouter('/api/v1/user', {
  tag: 'Resident - Vehicles & Parking',
  tagDescription: 'Register vehicles, request parking and view parking details',
  roles: [UserType.RESIDENT],
  societyScoped: true,
  feature: 'vehicles',
});
crudRoutes(vehicleResidentRouter, {
  path: '/vehicles',
  name: 'Vehicle',
  controller: crudController(vehicleService, {
    label: 'Vehicle',
    scope: (r) => ({ userId: r.auth.userId }),
    prepare: (r, b) => {
      if (!r.auth.flatIds.includes(b.flatId)) throw ApiError.forbidden('You do not belong to this flat', 'FLAT_FORBIDDEN');
      return { ...b, userId: r.auth.userId };
    },
  }),
  create: s.vehicleBody,
  update: s.vehicleBody.omit({ flatId: true }).partial(),
  query: s.vehicleQuery,
  item: s.vehicleItem,
});
vehicleResidentRouter
  .add({ method: 'post', path: '/parking/requests', summary: 'Request a parking allocation', body: s.requestBody, response: s.requestItem, status: 201, errors: [404, 409], handler: async (req: Request, res: Response) => created(res, await p.request(sid(req), req.auth.userId, req.auth.flatIds, req.valid.body), 'Request submitted') })
  .add({ method: 'get', path: '/parking/requests', summary: 'My parking requests', query: s.requestQuery, response: s.requestItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await p.listRequests(sid(req), req.valid.query, { userId: req.auth.userId })) })
  .add({ method: 'post', path: '/parking/requests/:id/cancel', summary: 'Cancel a pending parking request', params: idParam, response: s.requestItem, status: 200, handler: async (req: Request, res: Response) => ok(res, await p.cancelRequest(sid(req), req.auth.userId, req.valid.params.id), 'Cancelled') })
  .add({ method: 'get', path: '/parking/slots', summary: 'Parking slots allocated to my flats', query: s.slotQuery, response: s.slotItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await slotService.list(sid(req), req.valid.query, { flatId: { $in: req.auth.flatIds } })) });

export const vehicleAdminRouter = new ModuleRouter('/api/v1/admin', { tag: 'Society Admin - Vehicles & Parking', tagDescription: 'Vehicle registry, parking slots, allocations and requests', roles: [UserType.SOCIETY_ADMIN], societyScoped: true, feature: 'vehicles' });
vehicleAdminRouter.add({ method: 'get', path: '/vehicles', summary: 'All registered vehicles', permissions: [P.VEHICLE_MANAGE], query: s.vehicleQuery, response: s.vehicleItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await vehicleService.list(sid(req), req.valid.query)) });
crudRoutes(vehicleAdminRouter, { path: '/parking/slots', name: 'Parking slot', controller: crudController(slotService, { label: 'Parking slot' }), create: s.slotBody, query: s.slotQuery, item: s.slotItem, read: [P.PARKING_MANAGE], write: [P.PARKING_MANAGE] });
vehicleAdminRouter
  .add({ method: 'post', path: '/parking/slots/:id/allocate', summary: 'Allocate a slot to a flat/vehicle', permissions: [P.PARKING_MANAGE], params: idParam, body: s.allocateBody, response: s.slotItem, status: 200, errors: [404, 409], handler: async (req: Request, res: Response) => ok(res, await p.allocate(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Slot allocated') })
  .add({ method: 'post', path: '/parking/slots/:id/release', summary: 'Release an allocated slot', permissions: [P.PARKING_MANAGE], params: idParam, response: s.slotItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await p.release(sid(req), req.auth.userId, req.valid.params.id), 'Slot released') })
  .add({ method: 'get', path: '/parking/requests', summary: 'Parking allocation requests', permissions: [P.PARKING_MANAGE], query: s.requestQuery, response: s.requestItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await p.listRequests(sid(req), req.valid.query)) })
  .add({ method: 'post', path: '/parking/requests/:id/decide', summary: 'Approve (with a slot) or reject a request', permissions: [P.PARKING_MANAGE], params: idParam, body: s.decideBody, response: s.requestItem, status: 200, errors: [400, 409], handler: async (req: Request, res: Response) => ok(res, await p.decide(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Decision recorded') });
