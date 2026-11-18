import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import * as s from './helpdesk.schema';
import { helpdeskService as svc } from './helpdesk.service';

const sid = (r: Request) => r.auth.societyId!;

export const helpdeskAdminRouter = new ModuleRouter('/api/v1/admin/helpdesk', {
  tag: 'Society Admin - Helpdesk Directory',
  tagDescription: 'Outside service providers (plumber, electrician, mechanic, doctor, ...) shown to residents and guards. They do not log in; residents just call them.',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
});
const manage = [P.HELPDESK_MANAGE];
helpdeskAdminRouter.add({ method: 'get', path: '/categories', summary: 'Standard and custom helpdesk categories with counts', permissions: manage, response: z.array(s.categoryItem), handler: async (req: Request, res: Response) => ok(res, await svc.categories(sid(req), false)) });
crudRoutes(helpdeskAdminRouter, {
  path: '/',
  name: 'Helpdesk contact',
  plural: 'Helpdesk contacts',
  controller: {
    list: async (req: Request, res: Response) => paged(res, await svc.list(sid(req), req.valid.query)),
    get: async (req: Request, res: Response) => ok(res, await svc.get(sid(req), req.valid.params.id)),
    create: async (req: Request, res: Response) => created(res, await svc.create(sid(req), req.auth.userId, req.valid.body), 'Contact added'),
    update: async (req: Request, res: Response) => ok(res, await svc.update(sid(req), req.valid.params.id, req.auth.userId, req.valid.body), 'Contact updated'),
    remove: async (req: Request, res: Response) => {
      await svc.remove(sid(req), req.valid.params.id, req.auth.userId);
      ok(res, null, 'Contact deleted');
    },
  },
  create: s.helpdeskBody,
  update: s.helpdeskUpdate,
  query: s.helpdeskQuery,
  item: s.helpdeskItem,
  read: manage,
  write: manage,
});

export const helpdeskResidentRouter = new ModuleRouter('/api/v1/user/helpdesk', { tag: 'Resident - Helpdesk Directory', tagDescription: 'Service providers published by my society admin', roles: [UserType.RESIDENT], societyScoped: true });
helpdeskResidentRouter
  .add({ method: 'get', path: '/categories', summary: 'Categories that have visible contacts', response: z.array(s.categoryItem), handler: async (req: Request, res: Response) => ok(res, await svc.categories(sid(req), true)) })
  .add({ method: 'get', path: '/', summary: 'Plumbers, mechanics, doctors and other contacts for my society', query: s.residentHelpdeskQuery, response: s.residentHelpdeskItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.listVisible(sid(req), req.valid.query)) });

export const helpdeskGuardRouter = new ModuleRouter('/api/v1/guard/helpdesk', { tag: 'Guard', roles: [UserType.GUARD], societyScoped: true });
helpdeskGuardRouter.add({ method: 'get', path: '/', summary: 'Helpdesk contacts of my society', query: s.residentHelpdeskQuery, response: s.residentHelpdeskItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.listVisible(sid(req), req.valid.query)) });
