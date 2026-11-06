import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { ymd } from '../../common/utils/dates';
import { idParam, listQuery } from '../../common/validators/common';
import { deliveryService as dl } from '../delivery/delivery.service';
import * as ds from '../delivery/delivery.schema';
import { Delivery } from '../delivery/delivery.model';
import { domesticService as dh } from '../domestic-help/domestic.service';
import * as dhs from '../domestic-help/domestic.schema';
import { EmergencyAlert } from '../emergency/emergency.model';
import * as es from '../emergency/emergency.schema';
import { contactService, emergencyService, lostFoundService, reportIncident } from '../emergency/emergency.service';
import { Visitor, VisitorInvitation } from '../visitors/visitor.model';
import * as vs from '../visitors/visitor.schema';
import { visitorService as v } from '../visitors/visitor.service';
import { Gate } from '../society/society.model';

export const guardRouter = new ModuleRouter('/api/v1/guard', {
  tag: 'Guard',
  tagDescription: 'Simplified security interface. Guards only see minimal data (flat label, visitor details) for their own society and gate; residents\' personal and financial data is never exposed.',
  roles: [UserType.GUARD],
  societyScoped: true,
});

const ctx = (r: Request) => ({ societyId: r.auth.societyId!, userId: r.auth.userId, gateId: r.auth.gateId });
const sid = (r: Request) => r.auth.societyId!;

const dashboardItem = z.object({
  today: z.object({ visitors: z.number().int(), deliveries: z.number().int(), domesticHelpPresent: z.number().int() }),
  expectedVisitors: z.number().int(),
  pendingApprovals: z.object({ visitors: z.number().int(), deliveries: z.number().int() }),
  activeVisitors: z.number().int(),
  activeEmergencyAlerts: z.number().int(),
  recentActivity: z.array(vs.visitorItem.pick({ id: true, name: true, flatLabel: true, status: true, entryAt: true, exitAt: true })),
});

guardRouter
  .add({ method: 'get', path: '/dashboard', summary: 'Guard dashboard', description: 'Today\'s visitor count, expected visitors, pending approvals, deliveries, domestic help attendance, active visitors, emergency alerts and recent entry/exit history for the guard\'s society.', response: dashboardItem, handler: async (req: Request, res: Response) => {
    const societyId = sid(req);
    const start = new Date(`${ymd()}T00:00:00.000Z`);
    const now = new Date();
    const [visitors, deliveries, present, expected, pv, pd, active, alerts, recent] = await Promise.all([
      Visitor.countDocuments({ societyId, createdAt: { $gte: start } }),
      Delivery.countDocuments({ societyId, createdAt: { $gte: start } }),
      dh.todayPresent(societyId),
      VisitorInvitation.countDocuments({ societyId, status: 'ACTIVE', validTo: { $gte: now }, validFrom: { $lte: new Date(now.getTime() + 86400000) } }),
      Visitor.countDocuments({ societyId, status: 'PENDING_APPROVAL' }),
      Delivery.countDocuments({ societyId, status: 'PENDING_APPROVAL' }),
      Visitor.countDocuments({ societyId, status: 'CHECKED_IN' }),
      EmergencyAlert.countDocuments({ societyId, status: { $in: ['ACTIVE', 'ACKNOWLEDGED'] } }),
      Visitor.find({ societyId }).select('name flatLabel status entryAt exitAt').sort({ createdAt: -1 }).limit(10),
    ]);
    ok(res, { today: { visitors, deliveries, domesticHelpPresent: present }, expectedVisitors: expected, pendingApprovals: { visitors: pv, deliveries: pd }, activeVisitors: active, activeEmergencyAlerts: alerts, recentActivity: recent });
  } })
  .add({ method: 'get', path: '/gate', summary: 'My assigned gate', response: z.object({ id: z.string(), name: z.string(), type: z.string(), location: z.string().optional() }), handler: async (req: Request, res: Response) => {
    const g: any = await Gate.findOne({ _id: req.auth.gateId, societyId: sid(req) });
    ok(res, { id: String(g._id), name: g.name, type: g.type, location: g.location });
  } })
  .add({ method: 'get', path: '/flats/lookup', summary: 'Find a destination flat (label only)', description: 'Returns only flat labels — no resident names, phone numbers or other personal data.', query: vs.flatLookupQuery, response: z.array(vs.flatLookupItem), handler: async (req: Request, res: Response) => ok(res, await v.lookupFlats(sid(req), req.valid.query.q, req.valid.query.limit)) })

  .add({ method: 'post', path: '/visitors', summary: 'Register a walk-in visitor and request resident approval', description: 'Applies the society visitor policy: approval-required types go to PENDING_APPROVAL and residents are notified in real time (visitor:arrived).', body: vs.guardRegisterBody, response: vs.visitorItem, status: 201, handler: async (req: Request, res: Response) => created(res, await v.register(ctx(req), req.valid.body), 'Visitor registered') })
  .add({ method: 'get', path: '/visitors', summary: 'Search visitor records', query: vs.guardVisitorQuery, response: vs.visitorItem, paginated: true, handler: async (req: Request, res: Response) => {
    const q = req.valid.query;
    paged(res, await v.list(sid(req), { ...q, search: q.search ?? q.q }, {}, v.guardFields));
  } })
  .add({ method: 'get', path: '/visitors/pending', summary: 'Visitors pending approval', query: listQuery, response: vs.visitorItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await v.list(sid(req), { ...req.valid.query, status: 'PENDING_APPROVAL' }, {}, v.guardFields)) })
  .add({ method: 'get', path: '/visitors/active', summary: 'Visitors currently inside', query: listQuery, response: vs.visitorItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await v.list(sid(req), { ...req.valid.query, status: 'CHECKED_IN' }, {}, v.guardFields)) })
  .add({ method: 'get', path: '/visitors/expected', summary: 'Expected (pre-approved) visitors', description: 'Pass codes are never returned.', response: z.array(vs.expectedItem), handler: async (req: Request, res: Response) => ok(res, await v.expected(sid(req))) })
  .add({ method: 'post', path: '/visitors/verify', summary: 'Verify a visitor pass by OTP code or scanned QR token', description: 'On success a visitor record is created already APPROVED (PRE_APPROVED) and the resident is notified.', body: vs.verifyBody, response: vs.visitorItem, status: 200, errors: [400, 409], handler: async (req: Request, res: Response) => ok(res, await v.verifyPass(ctx(req), req.valid.body), 'Pass verified') })
  .add({ method: 'post', path: '/visitors/emergency-entry', summary: 'Record an emergency entry (ambulance, fire, police)', description: 'Bypasses resident approval, requires a reason, writes an audit entry and notifies admins and the flat.', body: vs.emergencyEntryBody, response: vs.visitorItem, status: 201, errors: [403], handler: async (req: Request, res: Response) => created(res, await v.emergencyEntry(ctx(req), req.valid.body), 'Emergency entry recorded') })
  .add({ method: 'post', path: '/visitors/:id/request-approval', summary: 'Re-contact the resident for approval', params: idParam, response: vs.visitorItem, status: 200, errors: [404], handler: async (req: Request, res: Response) => ok(res, await v.resend(ctx(req), req.valid.params.id), 'Resident notified') })
  .add({ method: 'post', path: '/visitors/:id/entry', summary: 'Record visitor entry', description: 'Enforces the society security policy: entry is only allowed when approved, pre-approved, or when the approval timeout policy is ALLOW.', params: idParam, response: vs.visitorItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await v.entry(ctx(req), req.valid.params.id), 'Entry recorded') })
  .add({ method: 'post', path: '/visitors/:id/exit', summary: 'Record visitor exit', params: idParam, response: vs.visitorItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await v.exit(ctx(req), req.valid.params.id), 'Exit recorded') })
  .add({ method: 'post', path: '/visitors/:id/deny', summary: 'Reject unauthorized entry', params: idParam, body: vs.denyBody, response: vs.visitorItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await v.deny(ctx(req), req.valid.params.id, req.valid.body.reason), 'Entry denied') })

  .add({ method: 'post', path: '/deliveries', summary: 'Register delivery personnel and notify the resident', body: ds.guardDeliveryBody, response: ds.deliveryItem, status: 201, feature: 'delivery', handler: async (req: Request, res: Response) => created(res, await dl.register(ctx(req), req.valid.body), 'Delivery registered') })
  .add({ method: 'get', path: '/deliveries', summary: 'Delivery log', query: ds.deliveryQuery, response: ds.deliveryItem, paginated: true, feature: 'delivery', handler: async (req: Request, res: Response) => paged(res, await dl.list(sid(req), req.valid.query)) })
  .add({ method: 'post', path: '/deliveries/:id/request-approval', summary: 'Re-contact the resident for delivery approval', params: idParam, response: ds.deliveryItem, status: 200, feature: 'delivery', handler: async (req: Request, res: Response) => ok(res, await dl.resend(ctx(req), req.valid.params.id), 'Resident notified') })
  .add({ method: 'post', path: '/deliveries/:id/entry', summary: 'Record delivery entry', params: idParam, response: ds.deliveryItem, status: 200, errors: [409], feature: 'delivery', handler: async (req: Request, res: Response) => ok(res, await dl.entry(ctx(req), req.valid.params.id), 'Entry recorded') })
  .add({ method: 'post', path: '/deliveries/:id/exit', summary: 'Record delivery exit', params: idParam, response: ds.deliveryItem, status: 200, errors: [409], feature: 'delivery', handler: async (req: Request, res: Response) => ok(res, await dl.exit(ctx(req), req.valid.params.id), 'Exit recorded') })
  .add({ method: 'post', path: '/deliveries/:id/leave-at-gate', summary: 'Accept parcel at the gate (Leave-at-Gate) and generate a collection OTP', description: 'The OTP is delivered to the resident only; the guard cannot see it.', params: idParam, response: ds.deliveryItem, status: 200, errors: [409], feature: 'delivery', handler: async (req: Request, res: Response) => ok(res, await dl.leaveAtGate(ctx(req), req.valid.params.id), 'Parcel recorded') })
  .add({ method: 'post', path: '/deliveries/:id/handover', summary: 'Hand over a parcel after verifying the resident\'s OTP', params: idParam, body: ds.handoverBody, response: ds.deliveryItem, status: 200, errors: [400, 409], feature: 'delivery', handler: async (req: Request, res: Response) => ok(res, await dl.handover(ctx(req), req.valid.params.id, req.valid.body.otp), 'Parcel handed over') })

  .add({ method: 'post', path: '/domestic-help/lookup', summary: 'Verify a domestic worker by entry code', body: dhs.guardHelpVerifyBody, response: dhs.guardHelpView, status: 200, errors: [403, 404], feature: 'domesticHelp', handler: async (req: Request, res: Response) => {
    const { _doc, ...view } = await dh.guardFind(sid(req), req.valid.body.code);
    ok(res, view);
  } })
  .add({ method: 'post', path: '/domestic-help/check-in', summary: 'Check in a domestic worker and notify assigned flats', body: dhs.guardHelpGateBody, response: dhs.guardHelpView, status: 200, errors: [403, 404, 409], feature: 'domesticHelp', handler: async (req: Request, res: Response) => ok(res, await dh.checkIn(ctx(req), req.valid.body.code), 'Checked in') })
  .add({ method: 'post', path: '/domestic-help/check-out', summary: 'Check out a domestic worker', body: dhs.guardHelpGateBody, response: dhs.guardHelpView, status: 200, errors: [403, 404, 409], feature: 'domesticHelp', handler: async (req: Request, res: Response) => ok(res, await dh.checkOut(ctx(req), req.valid.body.code), 'Checked out') })
  .add({ method: 'get', path: '/domestic-help/expected', summary: 'Verified domestic workers for today\'s roster', response: z.array(z.object({ id: z.string(), name: z.string(), helpType: z.string(), flats: z.array(z.string().optional()) })), feature: 'domesticHelp', handler: async (req: Request, res: Response) => ok(res, await dh.expectedToday(sid(req))) })
  .add({ method: 'post', path: '/domestic-help/unauthorized-report', summary: 'Report an unauthorized domestic-help visit', body: dhs.unauthorizedReportBody, response: es.incidentItem, status: 201, feature: 'domesticHelp', handler: async (req: Request, res: Response) => created(res, await reportIncident(sid(req), req.auth.userId, 'GUARD', { type: 'TRESPASS', description: `Unauthorized domestic help visit: ${req.valid.body.name ?? req.valid.body.helpId ?? 'unknown'}. ${req.valid.body.description}`, flatId: req.valid.body.flatId, attachments: [] }), 'Report recorded') })

  .add({ method: 'post', path: '/alerts', summary: 'Trigger an emergency alert', body: es.guardAlertBody, response: es.alertItem, status: 201, handler: async (req: Request, res: Response) => created(res, await emergencyService.raise({ ...ctx(req), source: 'GUARD' }, req.valid.body), 'Alert raised') })
  .add({ method: 'get', path: '/alerts', summary: 'Active emergency and panic alerts', query: es.alertQuery, response: es.alertItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await emergencyService.list(sid(req), req.valid.query)) })
  .add({ method: 'patch', path: '/alerts/:id', summary: 'Acknowledge or resolve an alert', params: idParam, body: es.alertUpdateBody, response: es.alertItem, errors: [409], handler: async (req: Request, res: Response) => ok(res, await emergencyService.update(sid(req), req.valid.params.id, req.auth.userId, req.valid.body), 'Alert updated') })
  .add({ method: 'post', path: '/incidents', summary: 'Report a suspicious activity or security incident', body: es.incidentBody, response: es.incidentItem, status: 201, handler: async (req: Request, res: Response) => created(res, await reportIncident(sid(req), req.auth.userId, 'GUARD', req.valid.body), 'Incident recorded') })
  .add({ method: 'post', path: '/lost-found', summary: 'Report a lost or found item', body: es.lostFoundBody, response: es.lostFoundItem, status: 201, handler: async (req: Request, res: Response) => created(res, await lostFoundService.create(sid(req), req.auth.userId, { ...req.valid.body, reportedBy: req.auth.userId }), 'Item recorded') })
  .add({ method: 'get', path: '/emergency-contacts', summary: 'Society emergency contacts and instructions', query: es.contactQuery, response: es.contactItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await contactService.list(sid(req), req.valid.query, { scope: 'SOCIETY' })) });
