import { Request, Response } from 'express';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { crudController } from '../../common/services/crud.controller';
import { idParam } from '../../common/validators/common';
import { z } from 'zod';
import { realtime } from '../../realtime/socket';
import { oid } from '../../common/utils/objectId';
import * as s from './emergency.schema';
import { contactService, emergencyService as e, incidentService, lostFoundService, reportIncident } from './emergency.service';

const sid = (r: Request) => r.auth.societyId!;

export const emergencyResidentRouter = new ModuleRouter('/api/v1/user/emergency', {
  tag: 'Resident - Emergency & Safety',
  tagDescription: 'Panic button, emergency contacts, incident reporting and lost & found',
  roles: [UserType.RESIDENT],
  societyScoped: true,
  feature: 'emergency',
});
emergencyResidentRouter
  .add({ method: 'post', path: '/alarm', summary: 'Raise an emergency alarm (one tap + "Are you sure?")', description: 'The app asks one confirmation question and sends confirm=true. No PIN or digits are needed. The alarm is attributed to the signed-in resident and one of their own flats. Guards, society admins and (when push is configured) closed apps are notified through the habito_emergency channel; socket event emergency:alert. A repeat within EMERGENCY_DEDUPE_SECONDS returns the existing alarm with duplicate=true instead of alerting everyone again.', body: s.alarmBody, response: s.alarmResponse, status: 201, errors: [403, 429], handler: async (req: Request, res: Response) => {
    const r = await e.raiseAlarm({ societyId: sid(req), userId: req.auth.userId, flatIds: req.auth.flatIds }, req.valid.body);
    res.status(r.duplicate ? 200 : 201).json({ success: true, message: r.duplicate ? 'Alarm already raised' : 'Emergency alert raised', data: r });
  } })
  .add({ method: 'post', path: '/staff-messages', summary: 'Send an emergency message to the guards or the society admins', body: s.staffMessageBody, response: s.staffMessageItem, status: 201, errors: [429], handler: async (req: Request, res: Response) => created(res, await e.staffMessage({ societyId: sid(req), userId: req.auth.userId, flatIds: req.auth.flatIds }, req.valid.body), 'Message sent') })
  .add({ method: 'post', path: '/panic', summary: 'Trigger the emergency panic button', description: 'Instantly alerts all guards and admins over Socket.IO (emergency:alert) and creates in-app notifications. Personal emergency contacts are recorded on the alert.', body: s.panicBody, response: s.alertItem, status: 201, handler: async (req: Request, res: Response) => {
    const flatId = req.valid.body.flatId ?? req.auth.flatIds[0];
    created(res, await e.raise({ societyId: sid(req), userId: req.auth.userId, source: 'RESIDENT' }, { ...req.valid.body, flatId }), 'Emergency alert raised');
  } })
  .add({ method: 'get', path: '/alerts', summary: 'My emergency alerts', query: s.alertQuery, response: s.alertItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await e.list(sid(req), req.valid.query, { raisedBy: req.auth.userId })) })
  .add({ method: 'post', path: '/incidents', summary: 'Report a security incident', body: s.incidentBody, response: s.incidentItem, status: 201, handler: async (req: Request, res: Response) => created(res, await reportIncident(sid(req), req.auth.userId, 'RESIDENT', req.valid.body), 'Incident reported') })
  .add({ method: 'get', path: '/incidents', summary: 'My reported incidents', query: s.incidentQuery, response: s.incidentItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await incidentService.list(sid(req), req.valid.query, { reportedBy: req.auth.userId })) })
  .add({ method: 'get', path: '/contacts', summary: 'Society emergency numbers', query: s.contactQuery, response: s.contactItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await contactService.list(sid(req), req.valid.query, { scope: 'SOCIETY', visibleToResidents: { $ne: false } })) })
  .add({ method: 'get', path: '/lost-found', summary: 'Browse lost & found', query: s.lostFoundQuery, response: s.lostFoundItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await lostFoundService.list(sid(req), req.valid.query)) })
  .add({ method: 'post', path: '/lost-found', summary: 'Report a lost or found item', body: s.lostFoundBody, response: s.lostFoundItem, status: 201, handler: async (req: Request, res: Response) => created(res, await lostFoundService.create(sid(req), req.auth.userId, { ...req.valid.body, reportedBy: req.auth.userId }), 'Item reported') })
  .add({ method: 'patch', path: '/lost-found/:id', summary: 'Mark my lost & found report claimed or closed', params: idParam, body: s.lostFoundUpdate, response: s.lostFoundItem, handler: async (req: Request, res: Response) => ok(res, await lostFoundService.update(sid(req), req.valid.params.id, req.auth.userId, req.valid.body, { reportedBy: req.auth.userId }), 'Updated') });

export const personalContactRouter = new ModuleRouter('/api/v1/user/emergency/personal-contacts', { tag: 'Resident - Emergency & Safety', roles: [UserType.RESIDENT], societyScoped: true, feature: 'emergency' });
crudRoutes(personalContactRouter, { path: '/', name: 'Personal emergency contact', plural: 'Personal emergency contacts', controller: crudController(contactService, { label: 'Contact', scope: (r) => ({ scope: 'PERSONAL', ownerUserId: r.auth.userId }), prepare: (r, b) => ({ ...b, scope: 'PERSONAL', ownerUserId: r.auth.userId }) }), create: s.contactBody, query: s.contactQuery, item: s.contactItem });

export const emergencyAdminRouter = new ModuleRouter('/api/v1/admin/security', {
  tag: 'Society Admin - Security & Visitors',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
  feature: 'emergency',
});
emergencyAdminRouter
  .add({ method: 'get', path: '/alerts', summary: 'Review security and emergency alerts', permissions: [P.SECURITY_MANAGE], query: s.alertQuery, response: s.alertItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await e.listForAdmin(sid(req), req.valid.query)) })
  .add({ method: 'patch', path: '/alerts/:id', summary: 'Acknowledge or resolve an alert', permissions: [P.EMERGENCY_MANAGE], params: idParam, body: s.alertUpdateBody, response: s.alertItem, errors: [409], handler: async (req: Request, res: Response) => ok(res, await e.update(sid(req), req.valid.params.id, req.auth.userId, req.valid.body, { role: 'SOCIETY_ADMIN' }), 'Alert updated') })
  .add({ method: 'get', path: '/staff-messages', summary: 'Emergency messages residents sent to admins / guards', permissions: [P.EMERGENCY_MANAGE], query: s.alertQuery.pick({ page: true, limit: true, sort: true, search: true, from: true, to: true }).extend({ audience: z.enum(['GUARDS', 'ADMIN']).optional() }), response: s.staffMessageItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await e.staffMessages(sid(req), req.valid.query)) })
  .add({ method: 'get', path: '/incidents', summary: 'Security incidents', permissions: [P.SECURITY_MANAGE], query: s.incidentQuery, response: s.incidentItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await incidentService.list(sid(req), req.valid.query)) })
  .add({ method: 'patch', path: '/incidents/:id', summary: 'Update incident status', permissions: [P.SECURITY_MANAGE], params: idParam, body: s.incidentUpdateBody, response: s.incidentItem, handler: async (req: Request, res: Response) => ok(res, await incidentService.update(sid(req), req.valid.params.id, req.auth.userId, req.valid.body), 'Incident updated') });
emergencyAdminRouter.add({ method: 'get', path: '/contacts/categories', summary: 'Emergency contact categories (standard + custom in use) with counts', permissions: [P.SOCIETY_READ], response: z.array(s.contactCategoryItem), handler: async (req: Request, res: Response) => {
  const rows = await contactService.model.aggregate([{ $match: { societyId: oid(sid(req)), scope: 'SOCIETY', isDeleted: { $ne: true } } }, { $group: { _id: '$category', count: { $sum: 1 } } }]);
  const used = new Map<string, number>(rows.map((r: any) => [r._id as string, r.count as number]));
  ok(res, [...new Set([...s.EMERGENCY_CONTACT_CATEGORIES, ...used.keys()])].map((category) => ({ category, count: used.get(category) ?? 0 })));
} });
const adminContacts = crudController(contactService, { label: 'Contact', scope: () => ({ scope: 'SOCIETY' }), prepare: (_r, b) => ({ ...b, scope: 'SOCIETY' }) });
const announce = (action: string, fn: (req: Request, res: Response) => Promise<unknown>) => async (req: Request, res: Response) => {
  const out = await fn(req, res);
  realtime.toSociety(sid(req), 'emergency:contacts-changed', { action });
  return out;
};
crudRoutes(emergencyAdminRouter, { path: '/contacts', name: 'Emergency contact', controller: { ...adminContacts, create: announce('created', adminContacts.create), update: announce('updated', adminContacts.update), remove: announce('deleted', adminContacts.remove) }, create: s.contactBody, update: s.contactUpdate, query: s.contactQuery, item: s.contactItem, read: [P.SOCIETY_READ], write: [P.EMERGENCY_MANAGE] });
