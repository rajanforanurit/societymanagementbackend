import { Request, Response } from 'express';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { ModuleRouter } from '../../common/openapi/router';
import { ok, paged } from '../../common/responses/respond';
import * as s from './platform.schema';
import { platformMonitor } from './platform.service';

export const platformMonitorRouter = new ModuleRouter('/api/v1/admin/platform', {
  tag: 'Society Admin - Platform',
  tagDescription: "Society-level authentication monitoring: login activity, failed logins and auth errors, always filtered by the admin's societyId. Raw server logs and infrastructure health are not exposed.",
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
});
const permissions = [P.PLATFORM_READ];
platformMonitorRouter
  .add({ method: 'get', path: '/summary', summary: 'Authentication overview for my society', permissions, query: s.summaryQuery, response: s.summaryItem, handler: async (req: Request, res: Response) => ok(res, await platformMonitor.summary(req.auth.societyId!, req.valid.query.days)) })
  .add({ method: 'get', path: '/login-activity', summary: "Successful and failed logins of my society's users", description: 'Identifiers are masked. Failed attempts are attributed to a society only when the account belongs to exactly one society or the society was named in the login request.', permissions, query: s.loginActivityQuery, response: s.loginActivityItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await platformMonitor.loginActivity(req.auth.societyId!, req.valid.query)) })
  .add({ method: 'get', path: '/auth-events', summary: 'Authentication / authorisation errors (401, 403, 429) in my society', description: 'Only auth-related failures. Server errors and stack traces are never returned.', permissions, query: s.authEventQuery, response: s.authEventItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await platformMonitor.authEvents(req.auth.societyId!, req.valid.query)) });
