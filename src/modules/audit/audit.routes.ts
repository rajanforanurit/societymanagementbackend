import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { ModuleRouter } from '../../common/openapi/router';
import { paged } from '../../common/responses/respond';
import { globalEntity } from '../../common/responses/schemas';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { dateTime, listQuery, objectId } from '../../common/validators/common';
import { AuditLog } from './audit.model';

const item = globalEntity({ actorId: objectId.optional(), actorRole: z.string().optional(), societyId: objectId.optional(), action: z.string(), entityType: z.string().optional(), entityId: z.string().optional(), statusCode: z.number().optional(), impersonationId: objectId.optional(), ip: z.string().optional(), requestId: z.string().optional(), hash: z.string().optional(), createdAt: dateTime });
const adminQuery = listQuery.extend({ actorId: objectId.optional(), action: z.string().max(100).optional(), entityType: z.string().max(60).optional(), entityId: z.string().max(60).optional() });
const superQuery = adminQuery.extend({ societyId: objectId.optional(), impersonationId: objectId.optional() });

const run = async (societyId: string | undefined, q: any) => {
  const f: Record<string, unknown> = {};
  if (societyId) f.societyId = societyId;
  ['actorId', 'entityType', 'entityId', 'impersonationId'].forEach((k) => q[k] && (f[k] = q[k]));
  if (q.action) f.action = new RegExp(`^${q.action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  return paginate(AuditLog, applyListFilters(f, q), q, { sortable: ['createdAt', 'action'] });
};

export const adminAuditRouter = new ModuleRouter('/api/v1/admin/audit-logs', { tag: 'Society Admin - Reports & Audit', tagDescription: 'Society reports and the audit trail of actions in this society', roles: [UserType.SOCIETY_ADMIN], societyScoped: true });
adminAuditRouter.add({ method: 'get', path: '/', summary: 'Audit trail for my society', description: 'Includes actions performed through super-admin impersonation sessions.', permissions: [P.AUDIT_READ], query: adminQuery, response: item, paginated: true, handler: async (req: Request, res: Response) => paged(res, await run(req.auth.societyId, req.valid.query)) });

export const superAuditRouter = new ModuleRouter('/api/v1/super-admin/audit-logs', { tag: 'Super Admin - Security', roles: [UserType.SUPER_ADMIN] });
superAuditRouter.add({ method: 'get', path: '/', summary: 'Platform-wide immutable audit trail', description: 'Append-only; records cannot be updated or deleted through the application.', query: superQuery, response: item, paginated: true, handler: async (req: Request, res: Response) => paged(res, await run(req.valid.query.societyId, req.valid.query)) });
