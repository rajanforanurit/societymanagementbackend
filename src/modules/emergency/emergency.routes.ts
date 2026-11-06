import { Request, Response } from 'express';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { crudController } from '../../common/services/crud.controller';
import { idParam } from '../../common/validators/common';
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
  .add({ method: 'post', path: '/panic', summary: 'Trigger the emergency panic button', description: 'Instantly alerts all guards and admins over Socket.IO (emergency:alert) and creates in-app notifications. Personal emergency contacts are recorded on the alert.', body: s.panicBody, response: s.alertItem, status: 201, handler: async (req: Request, res: Response) => {
    const flatId = req.valid.body.flatId ?? req.auth.flatIds[0];
    created(res, await e.raise({ societyId: sid(req), userId: req.auth.userId, source: 'RESIDENT' }, { ...req.valid.body, flatId }), 'Emergency alert raised');
  } })
  .add({ method: 'get', path: '/alerts', summary: 'My emergency alerts', query: s.alertQuery, response: s.alertItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await e.list(sid(req), req.valid.query, { raisedBy: req.auth.userId })) })
  .add({ method: 'post', path: '/incidents', summary: 'Report a security incident', body: s.incidentBody, response: s.incidentItem, status: 201, handler: async (req: Request, res: Response) => created(res, await reportIncident(sid(req), req.auth.userId, 'RESIDENT', req.valid.body), 'Incident reported') })
  .add({ method: 'get', path: '/incidents', summary: 'My reported incidents', query: s.incidentQuery, response: s.incidentItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await incidentService.list(sid(req), req.valid.query, { reportedBy: req.auth.userId })) })
  .add({ method: 'get', path: '/contacts', summary: 'Society emergency numbers', query: s.contactQuery, response: s.contactItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await contactService.list(sid(req), req.valid.query, { scope: 'SOCIETY' })) })
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
  .add({ method: 'get', path: '/alerts', summary: 'Review security and emergency alerts', permissions: [P.SECURITY_MANAGE], query: s.alertQuery, response: s.alertItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await e.list(sid(req), req.valid.query)) })
  .add({ method: 'patch', path: '/alerts/:id', summary: 'Acknowledge or resolve an alert', permissions: [P.EMERGENCY_MANAGE], params: idParam, body: s.alertUpdateBody, response: s.alertItem, errors: [409], handler: async (req: Request, res: Response) => ok(res, await e.update(sid(req), req.valid.params.id, req.auth.userId, req.valid.body), 'Alert updated') })
  .add({ method: 'get', path: '/incidents', summary: 'Security incidents', permissions: [P.SECURITY_MANAGE], query: s.incidentQuery, response: s.incidentItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await incidentService.list(sid(req), req.valid.query)) })
  .add({ method: 'patch', path: '/incidents/:id', summary: 'Update incident status', permissions: [P.SECURITY_MANAGE], params: idParam, body: s.incidentUpdateBody, response: s.incidentItem, handler: async (req: Request, res: Response) => ok(res, await incidentService.update(sid(req), req.valid.params.id, req.auth.userId, req.valid.body), 'Incident updated') });
crudRoutes(emergencyAdminRouter, { path: '/contacts', name: 'Emergency contact', controller: crudController(contactService, { label: 'Contact', scope: () => ({ scope: 'SOCIETY' }), prepare: (_r, b) => ({ ...b, scope: 'SOCIETY' }) }), create: s.contactBody, query: s.contactQuery, item: s.contactItem, read: [P.SOCIETY_READ], write: [P.EMERGENCY_MANAGE] });
