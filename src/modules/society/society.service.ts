import { NotificationType, SocietyStatus } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { createCrudService } from '../../common/services/crud.service';
import { applyListFilters, paginate, toDotPaths } from '../../common/utils/pagination';
import { addMinutes } from '../../common/utils/dates';
import { signAccessToken } from '../../common/utils/jwt';
import { withTransaction } from '../../common/utils/transaction';
import { env } from '../../config/env';
import { realtime } from '../../realtime/socket';
import { writeAudit } from '../audit/audit.service';
import { provisionAdmin } from '../admin/admin.service';
import { User } from '../auth/auth.model';
import { notifyUsers } from '../notifications/notify.service';
import { Role } from '../roles/roles.model';
import { seedSocietyRoles } from '../roles/roles.service';
import { ImpersonationSession, SubscriptionPlan } from '../super-admin/super-admin.model';
import { Block, Flat, Floor, Gate, Society, Tower } from './society.model';
import { applyLayout, assertLayoutNotShrinking, generateSocietyCode, houseNames, societyTypeFor, summarize } from './society.layout';
import { AdminProfile } from '../admin/admin.model';

async function ensureSocietyRoles(societyId: string, actorId: string, session?: any) {
  const existing: any = await Role.findOne({ societyId, key: 'COMMUNITY_ADMIN' }).session(session ?? null);
  if (existing) return existing;
  const roles = await seedSocietyRoles(societyId, actorId, session);
  return roles.find((r) => r.key === 'COMMUNITY_ADMIN')!;
}

async function welcomeAdmin(society: any, userId: string) {
  await notifyUsers({
    societyId: String(society._id),
    userIds: [userId],
    type: NotificationType.SYSTEM,
    title: `${society.name} is verified`,
    body: 'Your society is live. Sign in, change your temporary password, then add amenities, guards, other administrators and helpdesk contacts.',
    data: { route: 'society-setup', societyId: String(society._id) },
    event: 'society:verified',
  });
}

const withTotals = (details: any, type: 'MULTIFAMILY' | 'SINGLE_FAMILY') => ({ ...details, ...summarize(details, type) });

const isDuplicateCode = (e: any) => e?.code === 11000 && JSON.stringify(e.keyPattern ?? e.keyValue ?? {}).includes('code');

export const societyAdminService = {
  async create(input: any, actorId: string) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const { society, adminUserId } = await withTransaction(async (session) => {
          const { primaryAdmin, propertyType, propertyDetails, ...rest } = input;
          const code = await generateSocietyCode(input.name, session);
          const details = withTotals(propertyDetails, propertyType);
          const [society]: any[] = await Society.create([{ ...rest, code, propertyType, type: societyTypeFor(propertyType), propertyDetails: details, totalUnits: details.totalUnits, status: SocietyStatus.ACTIVE, approvedAt: new Date(), approvedBy: actorId, createdBy: actorId, subscription: { status: 'TRIAL', startsAt: new Date() } }], { session });
          const roles = await seedSocietyRoles(String(society._id), actorId, session);
          const owner = roles.find((r) => r.key === 'COMMUNITY_ADMIN')!;
          const { user } = await provisionAdmin(String(society._id), String(owner._id), { ...primaryAdmin, designation: 'Primary Administrator' }, actorId, session);
          await applyLayout(String(society._id), propertyType, details, actorId, session);
          await writeAudit({ actorId, actorRole: 'SUPER_ADMIN', societyId: String(society._id), action: 'SOCIETY_CREATED', entityType: 'Society', entityId: String(society._id), after: { name: society.name, code: society.code, propertyType } }, session);
          return { society, adminUserId: String(user._id) };
        });
        await welcomeAdmin(society, adminUserId);
        return society;
      } catch (e: any) {
        if (!isDuplicateCode(e) || attempt === 4) throw e;
      }
    }
    throw ApiError.conflict('Could not generate a unique society code', 'CODE_EXISTS');
  },
  async setPropertyInfo(id: string, input: any, actorId: string) {
    const existing: any = await Society.findById(id);
    if (!existing) throw ApiError.notFound('Society not found');
    const set: Record<string, unknown> = { updatedBy: actorId };
    if (input.hospitals) set.hospitals = input.hospitals;
    if (input.propertyDetails) {
      const type = input.propertyType ?? existing.propertyType;
      const hasLayout = !!(input.propertyDetails.towers?.length || input.propertyDetails.singleFamily);
      if (!hasLayout) {
        const keep = existing.propertyDetails?.toObject?.() ?? existing.propertyDetails ?? {};
        set.propertyDetails = { ...keep, ...input.propertyDetails, towers: keep.towers, singleFamily: keep.singleFamily, totalTowers: keep.totalTowers, totalFloors: keep.totalFloors, totalUnits: keep.totalUnits };
      } else {
        if (!type) throw ApiError.badRequest('Set the property type together with its layout', 'PROPERTY_TYPE_REQUIRED');
        if (existing.propertyType && existing.propertyType !== type && (await Flat.exists({ societyId: id }))) throw ApiError.conflict('The property type cannot change once units exist', 'PROPERTY_TYPE_LOCKED');
        const hadLayout = !!(existing.propertyDetails?.towers?.length || houseNames(existing.propertyDetails?.singleFamily).length);
        if (hadLayout) await assertLayoutNotShrinking(id, type, input.propertyDetails);
        const details = withTotals(input.propertyDetails, type);
        set.propertyDetails = details;
        set.propertyType = type;
        set.type = societyTypeFor(type);
        set.totalUnits = details.totalUnits;
        await withTransaction(async (session) => {
          await applyLayout(id, type, details, actorId, session);
        });
      }
    }
    const s: any = await Society.findByIdAndUpdate(id, { $set: set }, { new: true, runValidators: true });
    await writeAudit({ actorId, actorRole: 'SUPER_ADMIN', societyId: id, action: 'SOCIETY_PROPERTY_INFO_UPDATED', entityType: 'Society', entityId: id });
    realtime.toSociety(id, 'society:property-info-changed', { societyId: id });
    return s;
  },
  async administration(id: string) {
    const s: any = await Society.findById(id).select('name code status approvedAt approvedBy createdAt createdBy statusReason applicant');
    if (!s) throw ApiError.notFound('Society not found');
    const profiles: any[] = await AdminProfile.find({ societyId: id }).sort({ createdAt: 1 }).populate({ path: 'userId', select: 'name mobile email lastLoginAt isActive mustChangePassword' }).populate({ path: 'roleId', select: 'name key' });
    const actors: any[] = await User.find({ _id: { $in: [s.approvedBy, s.createdBy].filter(Boolean) } }).select('name');
    const nameOf = (uid: any) => actors.find((u) => String(u._id) === String(uid))?.name;
    const administrators = profiles.map((p) => {
      const u = p.userId && typeof p.userId === 'object' ? p.userId : undefined;
      const r = p.roleId && typeof p.roleId === 'object' ? p.roleId : undefined;
      return { id: String(p._id), userId: u ? String(u._id) : String(p.userId), name: u?.name ?? 'Unknown', mobile: u?.mobile, email: u?.email, designation: p.designation, role: r ? { id: String(r._id), name: r.name, key: r.key } : undefined, status: p.status, lastLoginAt: u?.lastLoginAt, mustChangePassword: !!u?.mustChangePassword, addedAt: p.createdAt, isPrimary: p.designation === 'Primary Administrator' };
    });
    return { societyId: id, societyName: s.name, code: s.code, status: s.status, createdAt: s.createdAt, createdByName: nameOf(s.createdBy), approvedAt: s.approvedAt, approvedByName: nameOf(s.approvedBy), statusReason: s.statusReason, applicant: s.applicant, administrators, counts: { total: administrators.length, active: administrators.filter((a) => a.status === 'ACTIVE').length } };
  },
  async list(query: any) {
    const filter: Record<string, any> = {};
    ['organizationId', 'type'].forEach((k) => query[k] && (filter[k] = query[k]));
    if (query.status === SocietyStatus.ACTIVE) filter.status = SocietyStatus.ACTIVE;
    else if (query.status === SocietyStatus.INACTIVE) filter.status = { $ne: SocietyStatus.ACTIVE };
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
    if (status === SocietyStatus.ACTIVE) await ensureSocietyRoles(id, actorId);
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
};

export const societyMineService = {
  async get(societyId: string) {
    return societyAdminService.get(societyId);
  },
  async update(societyId: string, data: any, actorId: string) {
    const flat = toDotPaths(data);
    const s = await Society.findByIdAndUpdate(societyId, { $set: { ...flat, updatedBy: actorId } }, { new: true, runValidators: true });
    if (!s) throw ApiError.notFound('Society not found');
    realtime.toSociety(societyId, 'society:updated', { societyId });
    return s;
  },
  async propertyInfo(societyId: string) {
    const s: any = await Society.findById(societyId).select('name address contact propertyDetails hospitals');
    if (!s) throw ApiError.notFound('Society not found');
    const j = s.toJSON();
    return { societyId, societyName: j.name, address: j.address, contact: j.contact ? { phone: j.contact.phone, emergencyPhone: j.contact.emergencyPhone } : undefined, propertyDetails: j.propertyDetails, hospitals: j.hospitals ?? [] };
  },

  async guardPropertyInfo(societyId: string) {
    const [info, towers, flats] = await Promise.all([
      this.propertyInfo(societyId),
      Tower.find({ societyId }).select('name').sort({ name: 1 }).lean(),
      Flat.find({ societyId }).select('label towerId').sort({ label: 1 }).lean(),
    ]);
    const groups = towers.map((tower) => ({ name: tower.name, flats: [] as { id: string; label: string }[] }));
    const byTower = new Map(towers.map((tower, index) => [String(tower._id), groups[index]]));
    const ungrouped: { id: string; label: string }[] = [];
    for (const flat of flats) {
      const group = flat.towerId ? byTower.get(String(flat.towerId)) : undefined;
      (group?.flats ?? ungrouped).push({ id: String(flat._id), label: flat.label });
    }
    if (ungrouped.length) {
      let name = groups.length ? 'Other units' : 'Houses';
      while (groups.some((group) => group.name === name)) name += ' (unassigned)';
      groups.push({ name, flats: ungrouped });
    }
    return { ...info, gateDirectory: groups.filter((group) => group.flats.length > 0) };
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
