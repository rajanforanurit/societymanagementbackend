import { Request, Response } from 'express';
import { z } from 'zod';
import { NotificationType, UserType, vals } from '../../common/constants/enums';
import { ModuleRouter } from '../../common/openapi/router';
import { ok, paged } from '../../common/responses/respond';
import { globalEntity } from '../../common/responses/schemas';
import { ApiError } from '../../common/utils/apiError';
import { paginate } from '../../common/utils/pagination';
import { dateTime, idParam, listQuery, objectId } from '../../common/validators/common';
import { Notification } from './notification.model';

const item = globalEntity({ userId: objectId, societyId: objectId.optional(), type: z.enum(vals(NotificationType)), title: z.string(), body: z.string(), data: z.record(z.string(), z.any()).optional(), readAt: dateTime.optional() });
const query = listQuery.extend({ type: z.enum(vals(NotificationType)).optional(), unread: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });

export const notificationRouter = new ModuleRouter('/api/v1/notifications', {
  tag: 'Notifications',
  tagDescription: 'In-app notification inbox. Real-time delivery uses Socket.IO (connect with auth.token = access token): events notification:new, visitor:arrived, visitor:decision, delivery:arrived, delivery:decision, emergency:alert, chat:message, approval:updated, complaint:updated, payment:success.',
  roles: [UserType.SOCIETY_ADMIN, UserType.GUARD, UserType.RESIDENT],
});

notificationRouter
  .add({ method: 'get', path: '/', summary: 'My notifications', query, response: item, paginated: true, handler: async (req: Request, res: Response) => {
    const q = req.valid.query;
    const f: Record<string, unknown> = { userId: req.auth.userId, ...(q.type ? { type: q.type } : {}), ...(q.unread === true ? { readAt: null } : {}) };
    paged(res, await paginate(Notification, f, q, { sortable: ['createdAt'] }));
  } })
  .add({ method: 'get', path: '/unread-count', summary: 'Unread notification count', response: z.object({ count: z.number().int() }), handler: async (req: Request, res: Response) => ok(res, { count: await Notification.countDocuments({ userId: req.auth.userId, readAt: null }) }) })
  .add({ method: 'post', path: '/read-all', summary: 'Mark all as read', response: z.object({ updated: z.number().int() }), status: 200, handler: async (req: Request, res: Response) => {
    const r = await Notification.updateMany({ userId: req.auth.userId, readAt: null }, { $set: { readAt: new Date() } });
    ok(res, { updated: r.modifiedCount });
  } })
  .add({ method: 'post', path: '/:id/read', summary: 'Mark one notification as read', params: idParam, response: item, status: 200, handler: async (req: Request, res: Response) => {
    const n = await Notification.findOneAndUpdate({ _id: req.valid.params.id, userId: req.auth.userId }, { $set: { readAt: new Date() } }, { new: true });
    if (!n) throw ApiError.notFound('Notification not found');
    ok(res, n);
  } });
