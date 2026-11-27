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
import { NotificationType } from '../../common/constants/enums';
import { notifyUsers } from '../notifications/notify.service';
import { Role } from '../roles/roles.model';
import { adminUserIdsWith } from '../roles/roles.service';
import { AdminProfile } from './admin.model';
import { Society } from '../society/society.model';
import { assertCanGrant, provisionAdmin } from './admin.service';

const assertRoleGrantable = async (req: Request, roleId?: string, extra?: string[]) => {
  if (!roleId && !extra?.length) return;
  const role: any = roleId ? await Role.findOne({ _id: roleId, societyId: req.auth.societyId }) : null;
  if (roleId && !role) throw ApiError.notFound('Role not found in this society');
  assertCanGrant(req.auth.permissions, { rolePermissions: role?.permissions, extra });
};

const assertRoleInAdminsSociety = async (adminProfileId: string, roleId?: string) => {
  if (!roleId) return;
  const p: any = await AdminProfile.findOne({ _id: adminProfileId }, null, { skipTenantCheck: true });
  if (!p) throw ApiError.notFound('Administrator not found');
  if (!(await Role.exists({ _id: roleId, societyId: p.societyId }))) throw ApiError.notFound('Role not found in this society');
};

const populateUser = { path: 'userId', select: 'name mobile email lastLoginAt' };
const populateRole = { path: 'roleId', select: 'name key' };
const populateSociety = { path: 'societyId', select: 'name code status' };
const shape = (p: any) => {
  const j = p.toJSON();
  const lift = (key: string, as: string) => {
    if (j[key] && typeof j[key] === 'object') {
      j[as] = j[key];
      j[key] = j[as].id;
    }
  };
  lift('userId', 'user');
  lift('roleId', 'role');
  lift('societyId', 'society');
  return j;
};

const listFor = async (societyId: string | undefined, query: any) => {
  const filter: Record<string, unknown> = {};
  if (societyId) filter.societyId = societyId;
  ['status', 'roleId'].forEach((k) => query[k] && (filter[k] = query[k]));
  const r = await paginate(AdminProfile, applyListFilters(filter, query), query, { populate: societyId ? [populateUser, populateRole] : [populateUser, populateRole, populateSociety], skipTenant: !societyId });
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
  return p.populate([populateUser, populateRole]);
};

export const adminMgmtController = {
  list: async (req: Request, res: Response) => paged(res, await listFor(req.auth.societyId, req.valid.query)),
  get: async (req: Request, res: Response) => {
    const p = await AdminProfile.findOne({ _id: req.valid.params.id, societyId: req.auth.societyId }).populate([populateUser, populateRole]);
    if (!p) throw ApiError.notFound('Administrator not found');
    ok(res, shape(p));
  },
  create: async (req: Request, res: Response) => {
    const { roleId, ...rest } = req.valid.body;
    const societyId = req.auth.societyId!;
    const r = await withTransaction((s) => provisionAdmin(societyId, roleId, rest, req.auth.userId, s, req.auth.permissions));
    const newUserId = String(r.user._id);
    await notifyUsers({ societyId, userIds: [newUserId], type: NotificationType.SYSTEM, title: `You are now an administrator of ${req.auth.societyName ?? 'your society'}`, body: 'Sign in with your mobile number and the temporary password you were given, then change it.', data: { route: 'society-setup', societyId }, event: 'admin:added' });
    const others = (await adminUserIdsWith(societyId)).filter((id) => id !== newUserId && id !== req.auth.userId);
    await notifyUsers({ societyId, userIds: others, type: NotificationType.SYSTEM, title: 'New administrator added', body: `${r.user.name} was added as an administrator.`, data: { adminProfileId: String(r.profile._id) }, event: 'admin:added' });
    created(res, shape(await r.profile.populate([populateUser, populateRole])), 'Administrator created');
  },
  update: async (req: Request, res: Response) => {
    const body = { ...req.valid.body };
    await assertRoleGrantable(req, body.roleId);
    if (String((await AdminProfile.findOne({ _id: req.valid.params.id, societyId: req.auth.societyId }))?.userId) === req.auth.userId && body.status && body.status !== 'ACTIVE') throw ApiError.conflict('You cannot deactivate your own administrator access', 'SELF_DEACTIVATION');
    ok(res, shape(await patch(req.auth.societyId, req.valid.params.id, body, req.auth.userId)), 'Administrator updated');
  },
  permissions: async (req: Request, res: Response) => {
    await assertRoleGrantable(req, req.valid.body.roleId, req.valid.body.extraPermissions);
    ok(res, shape(await patch(req.auth.societyId, req.valid.params.id, req.valid.body, req.auth.userId)), 'Permissions updated');
  },
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
    const society: any = await Society.findById(societyId).select('name');
    if (!society) throw ApiError.notFound('Society not found');
    const r = await withTransaction((s) => provisionAdmin(societyId, roleId, rest, req.auth.userId, s));
    await writeAudit({ actorId: req.auth.userId, actorRole: 'SUPER_ADMIN', societyId, action: 'ADMIN_CREATED', entityType: 'AdminProfile', entityId: String(r.profile._id) });
    const newUserId = String(r.user._id);
    await notifyUsers({ societyId, userIds: [newUserId], type: NotificationType.SYSTEM, title: `You are now an administrator of ${society.name}`, body: 'Sign in with your mobile number and the temporary password you were given, then change it.', data: { route: 'society-setup', societyId }, event: 'admin:added' });
    const others = (await adminUserIdsWith(societyId)).filter((id) => id !== newUserId);
    await notifyUsers({ societyId, userIds: others, type: NotificationType.SYSTEM, title: 'New administrator added', body: `${r.user.name} was added as an administrator by the platform team.`, data: { adminProfileId: String(r.profile._id) }, event: 'admin:added' });
    created(res, shape(await r.profile.populate([populateUser, populateRole])), 'Administrator created');
  },
  permissions: async (req: Request, res: Response) => {
    await assertRoleInAdminsSociety(req.valid.params.id, req.valid.body.roleId);
    ok(res, shape(await patch(undefined, req.valid.params.id, req.valid.body, req.auth.userId)), 'Permissions updated');
  },
  update: async (req: Request, res: Response) => {
    await assertRoleInAdminsSociety(req.valid.params.id, req.valid.body.roleId);
    ok(res, shape(await patch(undefined, req.valid.params.id, req.valid.body, req.auth.userId)), 'Administrator updated');
  },
  resetAccess: async (req: Request, res: Response) => ok(res, await resetAccess(undefined, req.valid.params.id, req.auth), 'Access reset'),
  activity: async (req: Request, res: Response) => {
    const p: any = await AdminProfile.findOne({ _id: req.valid.params.id }, null, { skipTenantCheck: true });
    if (!p) throw ApiError.notFound('Administrator not found');
    paged(res, await paginate(AuditLog, applyListFilters({ actorId: p.userId, societyId: p.societyId }, req.valid.query), req.valid.query, { sortable: ['createdAt'] }));
  },
};
