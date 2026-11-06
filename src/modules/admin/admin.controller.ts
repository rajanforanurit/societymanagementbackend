import { Request, Response } from 'express';
import { ApiError } from '../../common/utils/apiError';
import { created, ok, paged } from '../../common/responses/respond';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { randomToken } from '../../common/utils/crypto';
import { hashPassword } from '../../common/utils/password';
import { withTransaction } from '../../common/utils/transaction';
import { writeAudit } from '../audit/audit.service';
import { AuditLog } from '../audit/audit.model';
import { RefreshToken, User } from '../auth/auth.model';
import { AdminProfile } from './admin.model';
import { provisionAdmin } from './admin.service';

const populateUser = { path: 'userId', select: 'name mobile email lastLoginAt' };
const shape = (p: any) => {
  const j = p.toJSON();
  if (j.userId && typeof j.userId === 'object') {
    j.user = j.userId;
    j.userId = j.user.id;
  }
  return j;
};

const listFor = async (societyId: string | undefined, query: any) => {
  const filter: Record<string, unknown> = {};
  if (societyId) filter.societyId = societyId;
  ['status', 'roleId'].forEach((k) => query[k] && (filter[k] = query[k]));
  const r = await paginate(AdminProfile, applyListFilters(filter, query), query, { populate: populateUser, skipTenant: !societyId });
  return { ...r, items: r.items.map(shape) };
};

const resetAccess = async (societyId: string | undefined, id: string, actor: Request['auth']) => {
  const p: any = await AdminProfile.findOne({ _id: id, ...(societyId ? { societyId } : {}) }, null, societyId ? undefined : { skipTenantCheck: true });
  if (!p) throw ApiError.notFound('Administrator not found');
  const temporaryPassword = `Tmp@${randomToken(5)}A1`;
  await User.updateOne({ _id: p.userId }, { $set: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true, failedLoginCount: 0 }, $unset: { lockedUntil: 1 }, $inc: { tokenVersion: 1 } });
  await RefreshToken.updateMany({ userId: p.userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  await writeAudit({ actorId: actor.userId, actorRole: actor.userType, societyId: String(p.societyId), action: 'ADMIN_ACCESS_RESET', entityType: 'AdminProfile', entityId: id, impersonationId: actor.impersonationId });
  return { temporaryPassword };
};

const patch = async (societyId: string | undefined, id: string, body: any, actorId: string) => {
  const p = await AdminProfile.findOneAndUpdate({ _id: id, ...(societyId ? { societyId } : {}) }, { $set: { ...body, updatedBy: actorId } }, { new: true, runValidators: true, skipTenantCheck: !societyId });
  if (!p) throw ApiError.notFound('Administrator not found');
  return p.populate(populateUser);
};

export const adminMgmtController = {
  list: async (req: Request, res: Response) => paged(res, await listFor(req.auth.societyId, req.valid.query)),
  get: async (req: Request, res: Response) => {
    const p = await AdminProfile.findOne({ _id: req.valid.params.id, societyId: req.auth.societyId }).populate(populateUser);
    if (!p) throw ApiError.notFound('Administrator not found');
    ok(res, shape(p));
  },
  create: async (req: Request, res: Response) => {
    const { roleId, ...rest } = req.valid.body;
    const r = await withTransaction((s) => provisionAdmin(req.auth.societyId!, roleId, rest, req.auth.userId, s));
    created(res, shape(await r.profile.populate(populateUser)), 'Administrator created');
  },
  update: async (req: Request, res: Response) => {
    const body = { ...req.valid.body };
    if (String((await AdminProfile.findOne({ _id: req.valid.params.id, societyId: req.auth.societyId }))?.userId) === req.auth.userId && body.status && body.status !== 'ACTIVE') throw ApiError.conflict('You cannot deactivate your own administrator access', 'SELF_DEACTIVATION');
    ok(res, shape(await patch(req.auth.societyId, req.valid.params.id, body, req.auth.userId)), 'Administrator updated');
  },
  permissions: async (req: Request, res: Response) => ok(res, shape(await patch(req.auth.societyId, req.valid.params.id, req.valid.body, req.auth.userId)), 'Permissions updated'),
  resetAccess: async (req: Request, res: Response) => ok(res, await resetAccess(req.auth.societyId, req.valid.params.id, req.auth), 'Access reset'),
  remove: async (req: Request, res: Response) => {
    const p: any = await AdminProfile.findOne({ _id: req.valid.params.id, societyId: req.auth.societyId });
    if (!p) throw ApiError.notFound('Administrator not found');
    if (String(p.userId) === req.auth.userId) throw ApiError.conflict('You cannot remove yourself', 'SELF_DEACTIVATION');
    await AdminProfile.updateOne({ _id: p._id, societyId: req.auth.societyId }, { $set: { isDeleted: true, deletedAt: new Date(), status: 'INACTIVE' } });
    ok(res, null, 'Administrator removed');
  },
};

export const superAdminMgmtController = {
  list: async (req: Request, res: Response) => paged(res, await listFor(req.valid.query.societyId, req.valid.query).catch((e) => { throw e; })),
  create: async (req: Request, res: Response) => {
    const { roleId, societyId, ...rest } = req.valid.body;
    const r = await withTransaction((s) => provisionAdmin(societyId, roleId, rest, req.auth.userId, s));
    await writeAudit({ actorId: req.auth.userId, actorRole: 'SUPER_ADMIN', societyId, action: 'ADMIN_CREATED', entityType: 'AdminProfile', entityId: String(r.profile._id) });
    created(res, shape(await r.profile.populate(populateUser)), 'Administrator created');
  },
  permissions: async (req: Request, res: Response) => ok(res, shape(await patch(undefined, req.valid.params.id, req.valid.body, req.auth.userId)), 'Permissions updated'),
  update: async (req: Request, res: Response) => ok(res, shape(await patch(undefined, req.valid.params.id, req.valid.body, req.auth.userId)), 'Administrator updated'),
  resetAccess: async (req: Request, res: Response) => ok(res, await resetAccess(undefined, req.valid.params.id, req.auth), 'Access reset'),
  activity: async (req: Request, res: Response) => {
    const p: any = await AdminProfile.findOne({ _id: req.valid.params.id }, null, { skipTenantCheck: true });
    if (!p) throw ApiError.notFound('Administrator not found');
    paged(res, await paginate(AuditLog, applyListFilters({ actorId: p.userId, societyId: p.societyId }, req.valid.query), req.valid.query, { sortable: ['createdAt'] }));
  },
};
