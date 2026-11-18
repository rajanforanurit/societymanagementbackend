import { NotificationType, SocietyStatus, UserType } from '../../common/constants/enums';
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

/** Societies registered through the public form are PENDING and have no roles yet; make sure the role set exists. */
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
    body: 'Your society is live. Sign in, change your temporary password, then add flats, amenities, guards and helpdesk contacts.',
    data: { route: 'society-setup', societyId: String(society._id) },
    event: 'society:verified',
  });
}

const ownedFields = (input: any) => ({ ...(input.propertyDetails ? { propertyDetails: input.propertyDetails } : {}), ...(input.hospitals ? { hospitals: input.hospitals } : {}) });

export const societyAdminService = {
  async create(input: any, actorId: string) {
    const { society, adminUserId } = await withTransaction(async (session) => {
      if (await Society.exists({ code: input.code }).session(session ?? null)) throw ApiError.conflict('Society code already exists', 'CODE_EXISTS');
      const { primaryAdmin, ...rest } = input;
      const [society]: any[] = await Society.create([{ ...rest, status: SocietyStatus.ACTIVE, approvedAt: new Date(), approvedBy: actorId, createdBy: actorId, subscription: { status: 'TRIAL', startsAt: new Date() } }], { session });
      const roles = await seedSocietyRoles(String(society._id), actorId, session);
      const owner = roles.find((r) => r.key === 'COMMUNITY_ADMIN')!;
      const { user } = await provisionAdmin(String(society._id), String(owner._id), { ...primaryAdmin, designation: 'Primary Administrator' }, actorId, session);
      await writeAudit({ actorId, actorRole: 'SUPER_ADMIN', societyId: String(society._id), action: 'SOCIETY_CREATED', entityType: 'Society', entityId: String(society._id), after: { name: society.name, code: society.code } }, session);
      return { society, adminUserId: String(user._id) };
    });
    await welcomeAdmin(society, adminUserId);
    return society;
  },
  /** Verify a publicly registered society: create roles + primary admin, store property/hospital details, activate. */
  async approveRegistration(id: string, input: any, actorId: string) {
    const { society, adminUserId } = await withTransaction(async (session) => {
      const s: any = await Society.findById(id).session(session ?? null);
      if (!s) throw ApiError.notFound('Society not found');
      if (s.status !== SocietyStatus.PENDING) throw ApiError.conflict('Only PENDING registrations can be approved', 'INVALID_STATE');
      const name = input.name ?? s.applicant?.name;
      const mobile = input.mobile ?? s.applicant?.mobile;
      if (!name || !mobile) throw ApiError.badRequest('Administrator name and mobile are required', 'ADMIN_DETAILS_REQUIRED');
      const owner = await ensureSocietyRoles(id, actorId, session);
      const { user } = await provisionAdmin(id, String(owner._id), { name, mobile, email: input.email ?? s.applicant?.email, password: input.password, designation: input.designation ?? 'Primary Administrator' }, actorId, session);
      Object.assign(s, ownedFields(input));
      s.status = SocietyStatus.ACTIVE;
      s.statusReason = input.notes;
      s.approvedAt = new Date();
      s.approvedBy = actorId;
      s.updatedBy = actorId;
      s.subscription = { status: 'TRIAL', startsAt: new Date() };
      await s.save({ session });
      await writeAudit({ actorId, actorRole: 'SUPER_ADMIN', societyId: id, action: 'SOCIETY_REGISTRATION_APPROVED', entityType: 'Society', entityId: id, after: { adminUserId: String(user._id) } }, session);
      return { society: s, adminUserId: String(user._id) };
    });
    await welcomeAdmin(society, adminUserId);
    return society;
  },
  async rejectRegistration(id: string, reason: string, actorId: string) {
    const s: any = await Society.findOneAndUpdate({ _id: id, status: SocietyStatus.PENDING }, { $set: { status: SocietyStatus.REJECTED, statusReason: reason, updatedBy: actorId } }, { new: true });
    if (!s) throw ApiError.conflict('Only PENDING registrations can be rejected', 'INVALID_STATE');
    await writeAudit({ actorId, actorRole: 'SUPER_ADMIN', societyId: id, action: 'SOCIETY_REGISTRATION_REJECTED', entityType: 'Society', entityId: id, metadata: { reason } });
    return s;
  },
  /** Floor plan / property details and hospitals. Super Admin only; replaces the supplied part(s). */
  async setPropertyInfo(id: string, input: any, actorId: string) {
    const s: any = await Society.findByIdAndUpdate(id, { $set: { ...ownedFields(input), updatedBy: actorId } }, { new: true, runValidators: true });
    if (!s) throw ApiError.notFound('Society not found');
    await writeAudit({ actorId, actorRole: 'SUPER_ADMIN', societyId: id, action: 'SOCIETY_PROPERTY_INFO_UPDATED', entityType: 'Society', entityId: id });
    realtime.toSociety(id, 'society:property-info-changed', { societyId: id });
    return s;
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
  async registerPublic(input: any) {
    if (await Society.exists({ code: input.code })) throw ApiError.conflict('Society code already exists', 'CODE_EXISTS');
    const society: any = await Society.create({ ...input, status: SocietyStatus.PENDING });
    const superAdmins: any[] = await User.find({ userType: UserType.SUPER_ADMIN, isActive: true }).select('_id');
    await notifyUsers({ userIds: superAdmins.map((u) => u._id), type: NotificationType.SYSTEM, title: 'New society registration', body: `${society.name} (${society.code}) is waiting for verification`, data: { societyId: String(society._id), route: 'society-requests' }, event: 'society:registration' });
    return society;
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
  /** Read-only view of what the platform configured (floor plan + hospitals), for residents, guards and admins. */
  async propertyInfo(societyId: string) {
    const s: any = await Society.findById(societyId).select('name address contact propertyDetails hospitals');
    if (!s) throw ApiError.notFound('Society not found');
    const j = s.toJSON();
    return { societyId, societyName: j.name, address: j.address, contact: j.contact ? { phone: j.contact.phone, emergencyPhone: j.contact.emergencyPhone } : undefined, propertyDetails: j.propertyDetails, hospitals: j.hospitals ?? [] };
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
