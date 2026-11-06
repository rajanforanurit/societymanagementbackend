import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { listQuery, idParam } from '../../common/validators/common';
import { Flat } from '../society/society.model';
import { ApiError } from '../../common/utils/apiError';
import * as s from './visitor.schema';
import { visitorService as v } from './visitor.service';
import { deliveryService as d } from '../delivery/delivery.service';
import * as ds from '../delivery/delivery.schema';

const sid = (r: Request) => r.auth.societyId!;
const flatScope = (r: Request) => ({ flatId: { $in: r.auth.flatIds } });

export const residentVisitorRouter = new ModuleRouter('/api/v1/user', {
  tag: 'Resident - Visitors',
  tagDescription: 'Pre-approve guests, share QR/OTP passes, approve entries and deliveries, leave-at-gate',
  roles: [UserType.RESIDENT],
  societyScoped: true,
  feature: 'visitors',
});
residentVisitorRouter
  .add({ method: 'post', path: '/visitors/invitations', summary: 'Pre-approve a guest and generate a pass', description: 'Returns a 6-digit code and a signed QR token. Recurring passes (daily help, cab drivers) are supported through recurring.days.', body: s.invitationBody, response: s.invitationItem, status: 201, handler: async (req: Request, res: Response) => created(res, await v.createInvitation({ societyId: sid(req), userId: req.auth.userId, residents: req.auth.residents }, req.valid.body), 'Invitation created') })
  .add({ method: 'get', path: '/visitors/invitations', summary: 'List my invitations', query: s.invitationQuery, response: s.invitationItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await v.listInvitations(sid(req), req.valid.query, { flatId: { $in: req.auth.flatIds } })) })
  .add({ method: 'delete', path: '/visitors/invitations/:id', summary: 'Cancel an invitation', params: idParam, response: s.invitationItem, handler: async (req: Request, res: Response) => ok(res, await v.cancelInvitation(sid(req), req.auth.userId, req.valid.params.id), 'Invitation cancelled') })
  .add({ method: 'get', path: '/visitors', summary: 'Visitor history for my flats', query: s.visitorQuery, response: s.visitorItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await v.list(sid(req), req.valid.query, flatScope(req))) })
  .add({ method: 'get', path: '/visitors/pending', summary: 'Visitors awaiting my approval', query: listQuery, response: s.visitorItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await v.list(sid(req), { ...req.valid.query, status: 'PENDING_APPROVAL' }, flatScope(req))) })
  .add({ method: 'post', path: '/visitors/:id/respond', summary: 'Approve or reject a visitor at the gate', description: 'Guards at the gate receive the decision in real time over Socket.IO (visitor:decision).', params: idParam, body: s.respondBody, response: s.visitorItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await v.respond({ societyId: sid(req), userId: req.auth.userId, flatIds: req.auth.flatIds, residents: req.auth.residents }, req.valid.params.id, req.valid.body), 'Decision recorded') })
  .add({ method: 'get', path: '/deliveries', summary: 'Delivery history for my flats', query: ds.deliveryQuery, response: ds.deliveryItem, paginated: true, feature: 'delivery', handler: async (req: Request, res: Response) => paged(res, await d.list(sid(req), req.valid.query, flatScope(req))) })
  .add({ method: 'post', path: '/deliveries/:id/respond', summary: 'Approve, reject or choose leave-at-gate for a delivery', params: idParam, body: ds.deliveryRespondBody, response: ds.deliveryItem, status: 200, errors: [409], feature: 'delivery', handler: async (req: Request, res: Response) => ok(res, await d.respond({ societyId: sid(req), userId: req.auth.userId, residents: req.auth.residents }, req.valid.params.id, req.valid.body), 'Decision recorded') })
  .add({ method: 'put', path: '/deliveries/preferences', summary: 'Set standing delivery preferences (leave-at-gate / auto-approve)', body: ds.deliveryPrefBody, response: ds.deliveryPrefItem, feature: 'delivery', handler: async (req: Request, res: Response) => {
    const flatId = req.valid.body.flatId ?? req.auth.flatIds[0];
    if (!req.auth.flatIds.includes(flatId)) throw ApiError.forbidden('You do not belong to this flat', 'FLAT_FORBIDDEN');
    ok(res, await d.setPreference(sid(req), flatId, req.valid.body), 'Preferences saved');
  } });

export const adminVisitorRouter = new ModuleRouter('/api/v1/admin', {
  tag: 'Society Admin - Security & Visitors',
  tagDescription: 'Visitor logs, deliveries, overstay alerts, temporary passes and visitor policy',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
  feature: 'visitors',
});
adminVisitorRouter
  .add({ method: 'get', path: '/visitors', summary: 'Visitor entry and exit records', permissions: [P.VISITOR_READ], query: s.visitorQuery, response: s.visitorItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await v.list(sid(req), req.valid.query)) })
  .add({ method: 'get', path: '/visitors/active', summary: 'Visitors currently inside', permissions: [P.VISITOR_READ], query: listQuery, response: s.visitorItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await v.list(sid(req), { ...req.valid.query, status: 'CHECKED_IN' })) })
  .add({ method: 'get', path: '/visitors/emergency-entries', summary: 'Emergency entry records', permissions: [P.VISITOR_READ], query: listQuery, response: s.visitorItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await v.list(sid(req), req.valid.query, { isEmergencyEntry: true })) })
  .add({ method: 'get', path: '/visitors/passes', summary: 'Temporary access passes (invitations)', permissions: [P.VISITOR_READ], query: s.invitationQuery, response: s.invitationItem.omit({ code: true, qrToken: true }), paginated: true, handler: async (req: Request, res: Response) => {
    const r = await v.listInvitations(sid(req), req.valid.query);
    paged(res, { ...r, items: r.items.map((i: any) => ({ ...i, code: undefined, qrToken: undefined })) });
  } })
  .add({ method: 'get', path: '/deliveries', summary: 'Delivery personnel and parcel records', permissions: [P.VISITOR_READ], query: ds.deliveryQuery, response: ds.deliveryItem, paginated: true, feature: 'delivery', handler: async (req: Request, res: Response) => paged(res, await d.list(sid(req), req.valid.query)) })
  .add({ method: 'get', path: '/flats/:id/visitor-summary', summary: 'Visitor counts for a flat', permissions: [P.VISITOR_READ], params: idParam, response: z.object({ flatId: z.string(), total: z.number(), inside: z.number() }), handler: async (req: Request, res: Response) => {
    const flat = await Flat.findOne({ _id: req.valid.params.id, societyId: sid(req) });
    if (!flat) throw ApiError.notFound('Flat not found');
    const r = await v.list(sid(req), { page: 1, limit: 1 }, { flatId: flat._id });
    const inside = (await v.list(sid(req), { page: 1, limit: 1, status: 'CHECKED_IN' }, { flatId: flat._id })).meta.total;
    ok(res, { flatId: String(flat._id), total: r.meta.total, inside });
  } });
