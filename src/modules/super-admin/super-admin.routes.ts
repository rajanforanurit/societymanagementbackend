import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { globalCrudController } from '../../common/services/globalCrud';
import { idParam } from '../../common/validators/common';
import { AppConfig, NotificationTemplate, Organization, PlatformAnnouncement, SubscriptionPlan } from './super-admin.model';
import * as s from './super-admin.schema';
import { superAdminService as svc } from './super-admin.service';

const SA = [UserType.SUPER_ADMIN];

export const superDashboardRouter = new ModuleRouter('/api/v1/super-admin', { tag: 'Super Admin - Dashboard & Monitoring', tagDescription: 'Platform dashboard, health, error and feature-usage monitoring', roles: SA });
superDashboardRouter
  .add({ method: 'get', path: '/dashboard', summary: 'Platform dashboard', description: 'Societies (active/inactive/pending), builders, admins, residents, guards, platform activity and error statistics.', response: s.dashboardItem, handler: async (_r: Request, res: Response) => ok(res, await svc.dashboard()) })
  .add({ method: 'get', path: '/monitoring/health', summary: 'Backend service health', response: s.healthItem, handler: async (_r: Request, res: Response) => ok(res, await svc.health()) })
  .add({ method: 'get', path: '/monitoring/errors', summary: 'API errors and failed requests', description: 'Server errors and security-relevant failures (401/403/429) retained for 30 days. Stack traces are never returned.', query: s.errorLogQuery, response: s.errorLogItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.errors(req.valid.query)) })
  .add({ method: 'get', path: '/monitoring/feature-usage', summary: 'Feature usage by module (mutating actions)', query: s.usageQuery, response: s.featureUsage, handler: async (req: Request, res: Response) => ok(res, await svc.featureUsage(req.valid.query)) })
  .add({ method: 'get', path: '/monitoring/impersonations', summary: 'Impersonation sessions (who accessed which society, when and why)', query: s.impersonationQuery, response: s.impersonationItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.impersonations(req.valid.query)) });

export const superSecurityRouter = new ModuleRouter('/api/v1/super-admin/security', { tag: 'Super Admin - Security', roles: SA });
superSecurityRouter
  .add({ method: 'get', path: '/login-history', summary: 'Login history across the platform', query: s.loginHistoryQuery, response: s.loginHistoryItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.loginHistory(req.valid.query)) })
  .add({ method: 'get', path: '/suspicious-activity', summary: 'Suspicious activity (failed-login bursts, many accounts from one IP)', response: z.array(s.suspiciousItem), handler: async (_r: Request, res: Response) => ok(res, await svc.suspicious()) })
  .add({ method: 'get', path: '/users', summary: 'Search platform users', query: s.userQuery, response: s.userLite, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.users(req.valid.query)) })
  .add({ method: 'post', path: '/users/:id/block', summary: 'Block a user (access restriction)', description: 'Deactivates the account and revokes all sessions immediately.', params: idParam, body: s.blockBody, response: s.userLite, status: 200, errors: [403], handler: async (req: Request, res: Response) => {
    const u: any = await svc.setUserAccess(req.auth.userId, req.valid.params.id, true, req.valid.body.reason);
    ok(res, { id: String(u._id), name: u.name, mobile: u.mobile, userType: u.userType, isActive: u.isActive }, 'User blocked');
  } })
  .add({ method: 'post', path: '/users/:id/unblock', summary: 'Restore a blocked user', params: idParam, response: s.userLite, status: 200, handler: async (req: Request, res: Response) => {
    const u: any = await svc.setUserAccess(req.auth.userId, req.valid.params.id, false);
    ok(res, { id: String(u._id), name: u.name, mobile: u.mobile, userType: u.userType, isActive: u.isActive }, 'User unblocked');
  } });

export const superPlatformRouter = new ModuleRouter('/api/v1/super-admin', { tag: 'Super Admin - Platform Management', tagDescription: 'Builders/organizations, subscription plans, announcements, configuration and notification templates', roles: SA });
const org = globalCrudController({ model: Organization, name: 'Organization', label: 'Organization', searchFields: ['name'], filterable: ['status'], sortable: ['name', 'createdAt'] });
crudRoutes(superPlatformRouter, { path: '/organizations', name: 'Organization', controller: org, create: s.orgBody, query: s.orgQuery, item: s.orgItem });
const plan = globalCrudController({ model: SubscriptionPlan, name: 'Plan', label: 'Plan', searchFields: ['name', 'code'], filterable: ['isActive'], sortable: ['name', 'price', 'createdAt'] });
crudRoutes(superPlatformRouter, { path: '/plans', name: 'Subscription plan', controller: plan, create: s.planBody, update: s.planBody.partial(), query: s.planQuery, item: s.planItem });
const ann = globalCrudController({ model: PlatformAnnouncement, name: 'Announcement', label: 'Announcement', searchFields: ['title'], filterable: ['audience', 'isActive'], sortable: ['createdAt', 'startsAt'] });
crudRoutes(superPlatformRouter, { path: '/announcements', name: 'Platform announcement', controller: ann, create: s.announcementBody, query: s.announcementQuery, item: s.announcementItem });
const tpl = globalCrudController({ model: NotificationTemplate, name: 'Template', label: 'Template', searchFields: ['key', 'title'], filterable: ['channel', 'isActive'], sortable: ['key', 'createdAt'] });
crudRoutes(superPlatformRouter, { path: '/notification-templates', name: 'Notification template', controller: tpl, create: s.templateBody, query: s.templateQuery, item: s.templateItem });
superPlatformRouter
  .add({ method: 'get', path: '/configs', summary: 'Application configuration entries', query: z.object({}), response: z.array(s.configItem), handler: async (_r: Request, res: Response) => ok(res, await AppConfig.find({}).sort({ key: 1 })) })
  .add({ method: 'put', path: '/configs/:key', summary: 'Create or update a configuration value', params: s.configKey, body: s.configBody, response: s.configItem, handler: async (req: Request, res: Response) => ok(res, await AppConfig.findOneAndUpdate({ key: req.valid.params.key }, { $set: { value: req.valid.body.value, description: req.valid.body.description, updatedBy: req.auth.userId }, $setOnInsert: { key: req.valid.params.key } }, { upsert: true, new: true, setDefaultsOnInsert: true }), 'Configuration saved') });

export const superSupportRouter = new ModuleRouter('/api/v1/super-admin/support-tickets', { tag: 'Super Admin - Support', tagDescription: 'Support tickets raised by society admins or the platform team', roles: SA });
superSupportRouter
  .add({ method: 'get', path: '/', summary: 'List support tickets', query: s.ticketQuery, response: s.ticketItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.listTickets(req.valid.query)) })
  .add({ method: 'post', path: '/', summary: 'Create a ticket (optionally for a society)', body: s.superTicketBody, response: s.ticketItem, status: 201, handler: async (req: Request, res: Response) => created(res, await svc.createTicket({ userId: req.auth.userId, role: 'SUPER_ADMIN' }, req.valid.body), 'Ticket created') })
  .add({ method: 'get', path: '/:id', summary: 'Get ticket', params: idParam, response: s.ticketItem, handler: async (req: Request, res: Response) => ok(res, await svc.getTicket(req.valid.params.id)) })
  .add({ method: 'patch', path: '/:id', summary: 'Update status, priority or assignee', params: idParam, body: s.ticketUpdate, response: s.ticketItem, handler: async (req: Request, res: Response) => ok(res, await svc.updateTicket(req.valid.params.id, req.valid.body, req.auth.userId), 'Ticket updated') })
  .add({ method: 'post', path: '/:id/comments', summary: 'Comment on a ticket', params: idParam, body: s.ticketComment, response: s.ticketItem, status: 201, handler: async (req: Request, res: Response) => created(res, await svc.commentTicket(req.valid.params.id, { userId: req.auth.userId, role: 'SUPER_ADMIN' }, req.valid.body.message), 'Comment added') });

export const adminSupportRouter = new ModuleRouter('/api/v1/admin/support-tickets', { tag: 'Society Admin - Support', tagDescription: 'Raise and follow support tickets with the platform team', roles: [UserType.SOCIETY_ADMIN], societyScoped: true });
const own = (r: Request) => ({ societyId: r.auth.societyId });
adminSupportRouter
  .add({ method: 'post', path: '/', summary: 'Raise a support ticket', permissions: [P.SUPPORT_MANAGE], body: s.ticketBody, response: s.ticketItem, status: 201, handler: async (req: Request, res: Response) => created(res, await svc.createTicket({ userId: req.auth.userId, role: 'SOCIETY_ADMIN', societyId: req.auth.societyId }, req.valid.body), 'Ticket created') })
  .add({ method: 'get', path: '/', summary: 'My society\'s tickets', permissions: [P.SUPPORT_MANAGE], query: s.ticketQuery, response: s.ticketItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.listTickets({ ...req.valid.query, societyId: undefined }, own(req))) })
  .add({ method: 'get', path: '/:id', summary: 'Get ticket', permissions: [P.SUPPORT_MANAGE], params: idParam, response: s.ticketItem, handler: async (req: Request, res: Response) => ok(res, await svc.getTicket(req.valid.params.id, own(req))) })
  .add({ method: 'post', path: '/:id/comments', summary: 'Comment on a ticket', permissions: [P.SUPPORT_MANAGE], params: idParam, body: s.ticketComment, response: s.ticketItem, status: 201, handler: async (req: Request, res: Response) => created(res, await svc.commentTicket(req.valid.params.id, { userId: req.auth.userId, role: 'SOCIETY_ADMIN' }, req.valid.body.message, own(req)), 'Comment added') });

export const announcementReadRouter = new ModuleRouter('/api/v1/announcements', { tag: 'Notifications', roles: [UserType.SOCIETY_ADMIN, UserType.GUARD, UserType.RESIDENT] });
announcementReadRouter.add({ method: 'get', path: '/', summary: 'Active platform announcements for my role', response: z.array(s.announcementItem), handler: async (req: Request, res: Response) => ok(res, await svc.activeAnnouncements(req.auth.role, req.auth.societyId)) });
