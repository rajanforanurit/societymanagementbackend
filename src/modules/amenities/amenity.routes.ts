import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { crudController } from '../../common/services/crud.controller';
import { idParam } from '../../common/validators/common';
import * as s from './amenity.schema';
import { amenityExtra as x, amenityService } from './amenity.service';

const sid = (r: Request) => r.auth.societyId!;

export const amenityAdminRouter = new ModuleRouter('/api/v1/admin/amenities', {
  tag: 'Society Admin - Amenities',
  tagDescription: 'Amenity setup, slots, pricing, booking limits, blocked slots, cancellation policy and booking approvals',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
  feature: 'amenities',
});
const am = [P.AMENITY_MANAGE];
const bm = [P.BOOKING_MANAGE];
amenityAdminRouter
  .add({ method: 'get', path: '/bookings', summary: 'Booking history across amenities', permissions: bm, query: s.bookingQuery, response: s.bookingItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await x.list(sid(req), req.valid.query)) })
  .add({ method: 'post', path: '/bookings/:id/approve', summary: 'Approve a pending booking', permissions: bm, params: idParam, body: s.decideBody, response: s.bookingItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await x.decide(sid(req), req.auth.userId, req.valid.params.id, true), 'Booking approved') })
  .add({ method: 'post', path: '/bookings/:id/reject', summary: 'Reject a pending booking', permissions: bm, params: idParam, body: s.decideBody, response: s.bookingItem, status: 200, errors: [400, 409], handler: async (req: Request, res: Response) => ok(res, await x.decide(sid(req), req.auth.userId, req.valid.params.id, false, req.valid.body.reason), 'Booking rejected') })
  .add({ method: 'post', path: '/bookings/:id/cancel', summary: 'Cancel a booking on behalf of the resident (full refund)', permissions: bm, params: idParam, body: s.cancelBody, response: s.bookingItem, status: 200, errors: [404, 409], handler: async (req: Request, res: Response) => ok(res, await x.cancel(sid(req), { userId: req.auth.userId, admin: true }, req.valid.params.id, req.valid.body.reason), 'Booking cancelled') });
crudRoutes(amenityAdminRouter, { path: '/', name: 'Amenity', plural: 'Amenities', controller: crudController(amenityService, { label: 'Amenity' }), create: s.amenityBody, query: s.amenityQuery, item: s.amenityItem, read: [P.SOCIETY_READ], write: am });
amenityAdminRouter
  .add({ method: 'post', path: '/:id/blocked-slots', summary: 'Block a date or time range', permissions: am, params: idParam, body: s.blockBody, response: s.amenityItem, status: 201, handler: async (req: Request, res: Response) => created(res, await x.block(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Slot blocked') })
  .add({ method: 'delete', path: '/:id/blocked-slots', summary: 'Unblock a date or slot', permissions: am, params: idParam, body: s.unblockBody, response: s.amenityItem, status: 200, handler: async (req: Request, res: Response) => ok(res, await x.unblock(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Slot unblocked') });

export const amenityResidentRouter = new ModuleRouter('/api/v1/user', {
  tag: 'Resident - Amenities',
  tagDescription: 'Browse amenities, check slot availability, book, pay and cancel',
  roles: [UserType.RESIDENT],
  societyScoped: true,
  feature: 'amenities',
});
amenityResidentRouter
  .add({ method: 'get', path: '/amenities', summary: 'Available amenities', query: s.amenityQuery, response: s.amenityItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await amenityService.list(sid(req), { ...req.valid.query }, { status: 'ACTIVE' })) })
  .add({ method: 'get', path: '/amenities/bookings', summary: 'My booking history', query: s.bookingQuery, response: s.bookingItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await x.list(sid(req), req.valid.query, { flatId: { $in: req.auth.flatIds } })) })
  .add({ method: 'post', path: '/amenities/bookings/:id/cancel', summary: 'Cancel a booking', description: 'Refund follows the amenity cancellation policy; any unpaid booking invoice is cancelled.', params: idParam, body: s.cancelBody, response: s.bookingItem, status: 200, errors: [404, 409], handler: async (req: Request, res: Response) => ok(res, await x.cancel(sid(req), { userId: req.auth.userId, flatIds: req.auth.flatIds }, req.valid.params.id, req.valid.body.reason), 'Booking cancelled') })
  .add({ method: 'get', path: '/amenities/:id/slots', summary: 'Slot availability for a date', params: idParam, query: s.slotsQuery, response: z.array(s.slotItem), handler: async (req: Request, res: Response) => ok(res, await x.slots(sid(req), req.valid.params.id, req.valid.query.date)) })
  .add({ method: 'post', path: '/amenities/:id/bookings', summary: 'Book a slot', description: 'Race-safe: concurrent requests for the last seat are resolved by a unique index. Priced amenities generate an invoice payable through /invoices/{id}/pay. Amenities requiring approval start as PENDING.', params: idParam, body: s.bookBody, response: s.bookingItem, status: 201, errors: [400, 409], handler: async (req: Request, res: Response) => created(res, await x.book(sid(req), req.auth.userId, req.auth.residents, req.valid.params.id, req.valid.body), 'Booking created') });
