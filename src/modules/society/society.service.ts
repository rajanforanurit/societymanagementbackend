import { SocietyStatus } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { createCrudService } from '../../common/services/crud.service';
import { applyListFilters, paginate, toDotPaths } from '../../common/utils/pagination';
import { addMinutes } from '../../common/utils/dates';
import { signAccessToken } from '../../common/utils/jwt';
import { withTransaction } from '../../common/utils/transaction';
import { env } from '../../config/env';
import { writeAudit } from '../audit/audit.service';
import { provisionAdmin } from '../admin/admin.service';
import { User } from '../auth/auth.model';
import { seedSocietyRoles } from '../roles/roles.service';
import { ImpersonationSession, SubscriptionPlan } from '../super-admin/super-admin.model';
import { Block, Flat, Floor, Gate, Society, Tower } from './society.model';

export const societyAdminService = {
  async create(input: any, actorId: string) {
    return withTransaction(async (session) => {
      if (await Society.exists({ code: input.code }).session(session ?? null)) throw ApiError.conflict('Society code already exists', 'CODE_EXISTS');
      const { primaryAdmin, ...rest } = input;
      const [society]: any[] = await Society.create([{ ...rest, status: SocietyStatus.ACTIVE, approvedAt: new Date(), approvedBy: actorId, createdBy: actorId, subscription: { status: 'TRIAL', startsAt: new Date() } }], { session });
      const roles = await seedSocietyRoles(String(society._id), actorId, session);
      const owner = roles.find((r) => r.key === 'COMMUNITY_ADMIN')!;
      await provisionAdmin(String(society._id), String(owner._id), { ...primaryAdmin, designation: 'Primary Administrator' }, actorId, session);
      await writeAudit({ actorId, actorRole: 'SUPER_ADMIN', societyId: String(society._id), action: 'SOCIETY_CREATED', entityType: 'Society', entityId: String(society._id), after: { name: society.name, code: society.code } }, session);
      return society;
    });
  },
  async list(query: any) {
    const filter: Record<string, any> = {};
    ['status', 'organizationId', 'type'].forEach((k) => query[k] && (filter[k] = query[k]));
    return paginate(Society, applyListFilters(filter, query, ['name', 'code', 'address.city']), query, { sortable: ['name', 'createdAt', 'status'] });
  },
  async get(id: string) {
    const s = await Society.findById(id);
    if (!s) throw ApiError.notFound('Society not found');
    return s;
  },
  async update(id: string, data: any, actorId: string) {
    const s = await Society.findByIdAndUpdate(id, { $set: { ...toDotPaths(data), updatedBy: actorId } }, { new: true, runValidators: true });
    if (!s) throw ApiError.notFound('Society not found');
    return s;
  },
  async setStatus(id: string, status: string, reason: string | undefined, actorId: string) {
    const s: any = await Society.findById(id);
    if (!s) throw ApiError.notFound('Society not found');
    if (s.status === status) throw ApiError.conflict(`Society is already ${status}`, 'NO_CHANGE');
    const before = s.status;
    s.status = status;
    s.statusReason = reason;
    s.updatedBy = actorId;
    if (status === SocietyStatus.ACTIVE && !s.approvedAt) {
      s.approvedAt = new Date();
      s.approvedBy = actorId;
    }
    await s.save();
    await writeAudit({ actorId, actorRole: 'SUPER_ADMIN', societyId: id, action: `SOCIETY_${status}`, entityType: 'Society', entityId: id, before: { status: before }, after: { status }, metadata: { reason } });
    return s;
  },
  async remove(id: string, actorId: string) {
    const s = await Society.findByIdAndUpdate(id, { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actorId, status: SocietyStatus.INACTIVE } }, { new: true });
    if (!s) throw ApiError.notFound('Society not found');
    await writeAudit({ actorId, actorRole: 'SUPER_ADMIN', societyId: id, action: 'SOCIETY_DELETED', entityType: 'Society', entityId: id });
  },
  async setFeatures(id: string, features: Record<string, boolean>, actorId: string) {
    const flat: Record<string, boolean> = {};
    Object.entries(features).forEach(([k, v]) => v !== undefined && (flat[`features.${k}`] = v));
    const s = await Society.findByIdAndUpdate(id, { $set: { ...flat, updatedBy: actorId } }, { new: true });
    if (!s) throw ApiError.notFound('Society not found');
    return s;
  },
  async setPlan(id: string, input: any, actorId: string) {
    const plan: any = await SubscriptionPlan.findById(input.planId);
    if (!plan) throw ApiError.notFound('Plan not found');
    const set: Record<string, unknown> = { planId: plan._id, 'subscription.status': 'ACTIVE', 'subscription.startsAt': new Date(), updatedBy: actorId };
    if (input.subscriptionEndsAt) set['subscription.endsAt'] = new Date(input.subscriptionEndsAt);
    if (input.applyPlanFeatures) Object.entries(plan.features?.toObject?.() ?? plan.features ?? {}).forEach(([k, v]) => (set[`features.${k}`] = v));
    const s = await Society.findByIdAndUpdate(id, { $set: set }, { new: true });
    if (!s) throw ApiError.notFound('Society not found');
    return s;
  },
  async impersonate(id: string, input: { reason: string; durationMinutes: number }, actor: { userId: string; tv: number; ip?: string }) {
    const society: any = await Society.findById(id);
    if (!society) throw ApiError.notFound('Society not found');
    const minutes = Math.min(input.durationMinutes, env.IMPERSONATION_MAX_MINUTES);
    const expiresAt = addMinutes(new Date(), minutes);
    const [session]: any[] = await ImpersonationSession.create([{ superAdminId: actor.userId, societyId: id, reason: input.reason, expiresAt, ip: actor.ip }]);
    await writeAudit({ actorId: actor.userId, actorRole: 'SUPER_ADMIN', societyId: id, action: 'IMPERSONATION_STARTED', entityType: 'ImpersonationSession', entityId: String(session._id), metadata: { reason: input.reason, expiresAt }, impersonationId: String(session._id), ip: actor.ip });
    const user: any = await User.findById(actor.userId).select('+tokenVersion');
    const accessToken = signAccessToken({ sub: actor.userId, ut: 'SUPER_ADMIN', tv: user.tokenVersion ?? 0, sid: id, imp: String(session._id) }, minutes * 60);
    return { accessToken, tokenType: 'Bearer', expiresAt, sessionId: String(session._id), societyId: id };
  },
  async endImpersonation(sessionId: string, actorId: string) {
    const s: any = await ImpersonationSession.findOneAndUpdate({ _id: sessionId, superAdminId: actorId, endedAt: null }, { $set: { endedAt: new Date() } }, { new: true });
    if (!s) throw ApiError.notFound('Active impersonation session not found');
    await writeAudit({ actorId, actorRole: 'SUPER_ADMIN', societyId: String(s.societyId), action: 'IMPERSONATION_ENDED', entityType: 'ImpersonationSession', entityId: sessionId, impersonationId: sessionId });
  },
  async registerPublic(input: any) {
    if (await Society.exists({ code: input.code })) throw ApiError.conflict('Society code already exists', 'CODE_EXISTS');
    return Society.create({ ...input, status: SocietyStatus.PENDING });
  },
};

export const societyMineService = {
  async get(societyId: string) {
    return societyAdminService.get(societyId);
  },
  async update(societyId: string, data: any, actorId: string) {
    const flat = toDotPaths(data);
    const s = await Society.findByIdAndUpdate(societyId, { $set: { ...flat, updatedBy: actorId } }, { new: true, runValidators: true });
    if (!s) throw ApiError.notFound('Society not found');
    return s;
  },
};

const noChildren = (model: any, field: string, label: string) => async (societyId: string, id: string) => {
  if (await model.exists({ societyId, [field]: id })) throw ApiError.conflict(`Cannot delete: ${label} still reference this record`, 'HAS_DEPENDENTS');
};

export const blockService = createCrudService({ model: Block, name: 'Block', searchFields: ['name'], sortable: ['name', 'createdAt'], defaultSort: 'name', beforeRemove: noChildren(Tower, 'blockId', 'towers') });
export const towerService = createCrudService({ model: Tower, name: 'Tower', searchFields: ['name'], filterable: ['blockId'], sortable: ['name', 'createdAt'], defaultSort: 'name', beforeRemove: noChildren(Flat, 'towerId', 'flats') });
export const floorService = createCrudService({ model: Floor, name: 'Floor', filterable: ['towerId'], sortable: ['number', 'createdAt'], defaultSort: 'number' });
export const flatService = createCrudService({ model: Flat, name: 'Flat', searchFields: ['label', 'unitNumber'], filterable: ['towerId', 'blockId', 'status', 'floorNumber'], sortable: ['label', 'floorNumber', 'createdAt'], defaultSort: 'label' });
export const gateService = createCrudService({ model: Gate, name: 'Gate', searchFields: ['name', 'location'], sortable: ['name', 'createdAt'], defaultSort: 'name' });

export async function bulkCreateFlats(societyId: string, actorId: string, input: any) {
  const tower: any = await Tower.findOne({ _id: input.towerId, societyId });
  if (!tower) throw ApiError.notFound('Tower not found');
  if (input.toFloor < input.fromFloor) throw ApiError.badRequest('toFloor must be >= fromFloor');
  const total = (input.toFloor - input.fromFloor + 1) * input.unitsPerFloor;
  if (total > 2000) throw ApiError.badRequest('Cannot create more than 2000 flats at once');
  const docs: any[] = [];
  for (let f = input.fromFloor; f <= input.toFloor; f++) {
    for (let u = 1; u <= input.unitsPerFloor; u++) {
      const unit = `${f}${String(u).padStart(2, '0')}`;
      docs.push({ societyId, towerId: tower._id, blockId: tower.blockId, floorNumber: f, unitNumber: unit, label: `${tower.name}-${unit}`, unitType: input.unitType, areaSqft: input.areaSqft, createdBy: actorId, updatedBy: actorId });
    }
  }
  let created = 0;
  try {
    const res = await Flat.insertMany(docs, { ordered: false });
    created = res.length;
  } catch (err: any) {
    if (err?.code !== 11000 && !err?.writeErrors) throw err;
    created = err.insertedDocs?.length ?? err.result?.insertedCount ?? 0;
  }
  return { created, skipped: total - created };
}
