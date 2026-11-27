import { ApprovalEntityType, FlatStatus, NotificationType, ResidentStatus, ResidentType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { createCrudService } from '../../common/services/crud.service';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { withTransaction } from '../../common/utils/transaction';
import { writeAudit } from '../audit/audit.service';
import { applyTransition, registerWorkflowEntity } from '../approvals/approval.service';
import { User } from '../auth/auth.model';
import { File } from '../files/files.model';
import { notifyAdmins, notifyUsers } from '../notifications/notify.service';
import { Flat, Society } from '../society/society.model';
import { FamilyMember, MoveRequest, Resident } from './resident.model';

const populate = [
  { path: 'userId', select: 'name mobile email' },
  { path: 'flatId', select: 'label towerId', populate: { path: 'towerId', select: 'name', options: { skipTenantCheck: true } }, options: { skipTenantCheck: true } },
  { path: 'ownerResidentId', select: 'userId', populate: { path: 'userId', select: 'name mobile' }, options: { skipTenantCheck: true } },
];
const shape = (r: any) => {
  const j = r.toJSON();
  if (j.userId && typeof j.userId === 'object') (j.user = j.userId), (j.userId = j.user.id);
  if (j.flatId && typeof j.flatId === 'object') {
    const f = j.flatId;
    j.flatId = f.id;
    j.flat = { id: f.id, label: f.label };
    if (f.towerId && typeof f.towerId === 'object') j.tower = { id: f.towerId.id, name: f.towerId.name };
  }
  if (j.ownerResidentId && typeof j.ownerResidentId === 'object') {
    const o = j.ownerResidentId;
    j.ownerResidentId = o.id;
    if (o.userId && typeof o.userId === 'object') j.owner = { residentId: o.id, name: o.userId.name, mobile: o.userId.mobile };
  }
  return j;
};

async function withSociety(list: any[]) {
  const ids = [...new Set(list.map((j) => String(j.societyId)))];
  const socs: any[] = ids.length ? await Society.find({ _id: { $in: ids } }).select('name address') : [];
  const map = new Map(
    socs.map((x) => {
      const a = x.address ?? {};
      return [String(x._id), { id: String(x._id), name: x.name, city: a.city, address: { line1: a.line1, line2: a.line2, city: a.city, state: a.state, pincode: a.pincode, country: a.country } }];
    }),
  );
  return list.map((j) => ({ ...j, society: map.get(String(j.societyId)) }));
}

const OWNER_TYPES = new Set<string>([ResidentType.OWNER]);
const LINKED_TYPES = [ResidentType.TENANT, ResidentType.FAMILY_MEMBER, ResidentType.AUTHORIZED_OCCUPANT];

export async function syncOwnerLinks(societyId: string, flatId: string, session?: any) {
  const owner: any = await Resident.findOne({ societyId, flatId, residentType: ResidentType.OWNER, status: ResidentStatus.APPROVED }).sort({ approvedAt: 1, createdAt: 1 }).session(session ?? null);
  if (owner) {
    await Flat.updateOne({ _id: flatId, societyId }, { $set: { ownerResidentId: owner._id } }, { session });
    await Resident.updateMany({ societyId, flatId, residentType: { $in: LINKED_TYPES } }, { $set: { ownerResidentId: owner._id } }, { session });
  } else {
    await Flat.updateOne({ _id: flatId, societyId }, { $unset: { ownerResidentId: 1 } }, { session });
    await Resident.updateMany({ societyId, flatId, residentType: { $in: LINKED_TYPES } }, { $unset: { ownerResidentId: 1 } }, { session });
  }
  return owner ? String(owner._id) : undefined;
}

async function assertNoOtherOwner(societyId: string, flatId: string, userId: string, session?: any) {
  const other = await Resident.exists({ societyId, flatId, residentType: ResidentType.OWNER, status: ResidentStatus.APPROVED, userId: { $ne: userId } }).session(session ?? null);
  if (other) throw ApiError.conflict('This flat already has a registered owner. If you are a co-owner, please contact the society office.', 'OWNER_EXISTS');
}

export async function syncFlatOccupancy(societyId: string, flatId: string, session?: any) {
  const active = await Resident.countDocuments({ societyId, flatId, status: ResidentStatus.APPROVED }).session(session ?? null);
  await Flat.updateOne({ _id: flatId, societyId, status: { $ne: FlatStatus.BLOCKED } }, { $set: { status: active ? FlatStatus.OCCUPIED : FlatStatus.VACANT } }, { session });
}

export const residentAdmin = {
  async list(societyId: string, query: any) {
    const filter: Record<string, unknown> = { societyId };
    ['status', 'flatId', 'residentType', 'userId'].forEach((k) => query[k] && (filter[k] = query[k]));
    const r = await paginate(Resident, applyListFilters(filter, query), query, { populate });
    return { ...r, items: r.items.map(shape) };
  },
  async get(societyId: string, id: string) {
    const r = await Resident.findOne({ _id: id, societyId }).populate(populate);
    if (!r) throw ApiError.notFound('Resident not found');
    return shape(r);
  },
  async approve(societyId: string, id: string, actorId: string) {
    const r = await withTransaction(async (session) => {
      const pending: any = await Resident.findOne({ _id: id, societyId, status: ResidentStatus.PENDING }).session(session ?? null);
      if (!pending) throw ApiError.conflict('Only PENDING registrations can be approved', 'INVALID_STATE');
      if (OWNER_TYPES.has(pending.residentType)) await assertNoOtherOwner(societyId, String(pending.flatId), String(pending.userId), session);
      if (await Resident.exists({ societyId, userId: pending.userId, flatId: pending.flatId, status: ResidentStatus.APPROVED, _id: { $ne: pending._id } }).session(session ?? null)) throw ApiError.conflict('This person is already an approved resident of this flat', 'ALREADY_RESIDENT');
      const doc: any = await Resident.findOneAndUpdate({ _id: id, societyId, status: ResidentStatus.PENDING }, { $set: { status: ResidentStatus.APPROVED, approvedBy: actorId, approvedAt: new Date(), moveInDate: new Date(), updatedBy: actorId }, $unset: { rejectionReason: 1 } }, { new: true, session });
      if (!doc) throw ApiError.conflict('Only PENDING registrations can be approved', 'INVALID_STATE');
      const hasPrimary = await Resident.exists({ societyId, flatId: doc.flatId, status: ResidentStatus.APPROVED, isPrimary: true, _id: { $ne: doc._id } }).session(session ?? null);
      if (!hasPrimary && doc.residentType !== ResidentType.FAMILY_MEMBER) await Resident.updateOne({ _id: doc._id, societyId }, { $set: { isPrimary: true } }, { session });
      const ownerId = await syncOwnerLinks(societyId, String(doc.flatId), session);
      await syncFlatOccupancy(societyId, String(doc.flatId), session);
      await writeAudit({ actorId, actorRole: 'SOCIETY_ADMIN', societyId, action: 'RESIDENT_APPROVED', entityType: 'Resident', entityId: id, metadata: { residentType: doc.residentType, ownerResidentId: ownerId } }, session);
      return { doc, ownerId };
    });
    const doc: any = r.doc;
    const flat: any = await Flat.findOne({ _id: doc.flatId, societyId }).select('label');
    await notifyUsers({ societyId, userIds: [doc.userId], type: NotificationType.APPROVAL, title: 'Property access approved', body: `You are now a registered ${String(doc.residentType).toLowerCase().replace('_', ' ')} of ${flat?.label ?? 'your flat'}. All society features are now available.`, data: { residentId: id, route: 'society-requests' }, event: 'resident:approved' });
    if (doc.residentType === ResidentType.TENANT && r.ownerId) {
      const owner: any = await Resident.findOne({ _id: r.ownerId, societyId }).select('userId');
      const tenant: any = await User.findById(doc.userId).select('name');
      if (owner && String(owner.userId) !== String(doc.userId)) await notifyUsers({ societyId, userIds: [owner.userId], type: NotificationType.APPROVAL, title: 'Tenant registered', body: `${tenant?.name ?? 'A tenant'} was approved as the tenant of ${flat?.label ?? 'your flat'}.`, data: { residentId: id, route: 'tenants' }, event: 'resident:tenant-approved' });
    }
    return residentAdmin.get(societyId, id);
  },
  async reject(societyId: string, id: string, actorId: string, reason: string) {
    const doc: any = await Resident.findOneAndUpdate({ _id: id, societyId, status: ResidentStatus.PENDING }, { $set: { status: ResidentStatus.REJECTED, rejectionReason: reason, updatedBy: actorId } }, { new: true });
    if (!doc) throw ApiError.conflict('Only PENDING registrations can be rejected', 'INVALID_STATE');
    await writeAudit({ actorId, actorRole: 'SOCIETY_ADMIN', societyId, action: 'RESIDENT_REJECTED', entityType: 'Resident', entityId: id, metadata: { reason } });
    await notifyUsers({ societyId, userIds: [doc.userId], type: NotificationType.APPROVAL, title: 'Property access request rejected', body: `${reason} You can submit a new request from the app.`, data: { residentId: id, route: 'society-requests' }, event: 'resident:rejected' });
    return residentAdmin.get(societyId, id);
  },
  async setActive(societyId: string, id: string, actorId: string, active: boolean) {
    const from = active ? ResidentStatus.INACTIVE : ResidentStatus.APPROVED;
    const to = active ? ResidentStatus.APPROVED : ResidentStatus.INACTIVE;
    const doc: any = await Resident.findOneAndUpdate({ _id: id, societyId, status: from }, { $set: { status: to, updatedBy: actorId } }, { new: true });
    if (!doc) throw ApiError.conflict(`Resident must be ${from} to perform this action`, 'INVALID_STATE');
    if (active && OWNER_TYPES.has(doc.residentType)) {
      try {
        await assertNoOtherOwner(societyId, String(doc.flatId), String(doc.userId));
      } catch (e) {
        await Resident.updateOne({ _id: id, societyId }, { $set: { status: from } });
        throw e;
      }
    }
    await syncOwnerLinks(societyId, String(doc.flatId));
    await syncFlatOccupancy(societyId, String(doc.flatId));
    await writeAudit({ actorId, actorRole: 'SOCIETY_ADMIN', societyId, action: active ? 'RESIDENT_ACTIVATED' : 'RESIDENT_DEACTIVATED', entityType: 'Resident', entityId: id });
    return residentAdmin.get(societyId, id);
  },
  async update(societyId: string, id: string, actorId: string, body: any) {
    if (body.flatId && !(await Flat.exists({ _id: body.flatId, societyId }))) throw ApiError.notFound('Flat not found');
    const { permissions, ...rest } = body;
    const set: Record<string, unknown> = { ...rest, updatedBy: actorId };
    Object.entries(permissions ?? {}).forEach(([k, v]) => (set[`permissions.${k}`] = v));
    const before: any = await Resident.findOne({ _id: id, societyId });
    if (!before) throw ApiError.notFound('Resident not found');
    const nextType = body.residentType ?? before.residentType;
    const nextFlat = body.flatId ?? String(before.flatId);
    if (before.status === ResidentStatus.APPROVED && OWNER_TYPES.has(nextType)) await assertNoOtherOwner(societyId, nextFlat, String(before.userId));
    await Resident.updateOne({ _id: id, societyId }, { $set: set }, { runValidators: true });
    await syncOwnerLinks(societyId, String(before.flatId));
    if (body.flatId && String(before.flatId) !== body.flatId) {
      await syncOwnerLinks(societyId, body.flatId);
      await syncFlatOccupancy(societyId, String(before.flatId));
      await syncFlatOccupancy(societyId, body.flatId);
    }
    return residentAdmin.get(societyId, id);
  },
  async verify(societyId: string, id: string, actorId: string, body: any) {
    const doc: any = await Resident.findOneAndUpdate({ _id: id, societyId }, { $set: { ownershipVerified: body.ownershipVerified, verificationNotes: body.notes, updatedBy: actorId, ...(body.documentTypes?.length ? {} : {}) } }, { new: true });
    if (!doc) throw ApiError.notFound('Resident not found');
    if (body.documentTypes?.length) await Resident.updateOne({ _id: id, societyId }, { $set: { 'verificationDocs.$[d].verified': true } }, { arrayFilters: [{ 'd.type': { $in: body.documentTypes } }] });
    await writeAudit({ actorId, actorRole: 'SOCIETY_ADMIN', societyId, action: 'RESIDENT_VERIFIED', entityType: 'Resident', entityId: id, after: body });
    return residentAdmin.get(societyId, id);
  },
};

export const residentSelf = {
  async requestMembership(userId: string, input: any) {
    const society: any = await Society.findOne({ _id: input.societyId, status: 'ACTIVE' });
    if (!society) throw ApiError.notFound('Society not found or not active');
    if (society.features?.documents === false && input.documents?.length) input.documents = [];
    const flat = await Flat.findOne({ _id: input.flatId, societyId: input.societyId });
    if (!flat) throw ApiError.notFound('Flat not found in this society');
    for (const d of input.documents ?? []) {
      if (!(await File.exists({ _id: d.fileId, societyId: input.societyId, uploadedBy: userId }))) throw ApiError.badRequest('Document file not found', 'FILE_NOT_FOUND');
    }
    const user: any = await User.findById(userId).select('userType name');
    if (!user || user.userType !== 'RESIDENT') throw ApiError.forbidden('Only resident accounts can request property access', 'NOT_A_RESIDENT');
    const existing: any = await Resident.findOne({ societyId: input.societyId, userId, flatId: input.flatId, status: { $in: [ResidentStatus.PENDING, ResidentStatus.APPROVED] } });
    if (existing) {
      throw existing.status === ResidentStatus.APPROVED
        ? ApiError.conflict('You are already an approved resident of this flat', 'ALREADY_RESIDENT')
        : ApiError.conflict('You already have a pending request for this flat. Wait for the society admin, or cancel it to change the details.', 'REQUEST_EXISTS');
    }
    if (OWNER_TYPES.has(input.residentType)) await assertNoOtherOwner(input.societyId, input.flatId, userId);
    const ownerResidentId = OWNER_TYPES.has(input.residentType) ? undefined : (flat as any).ownerResidentId;
    const r: any = await Resident.create({ societyId: input.societyId, userId, flatId: input.flatId, residentType: input.residentType, relationToPrimary: input.relationToPrimary, verificationDocs: input.documents, tenancy: input.tenancy, ownerResidentId, createdBy: userId });
    await notifyAdmins(input.societyId, 'resident:approve', { type: NotificationType.APPROVAL, title: 'New property access request', body: `${user.name} requested access to ${flat.label} as ${input.residentType === 'OWNER' ? 'owner' : input.residentType === 'TENANT' ? 'tenant' : input.residentType.toLowerCase().replace('_', ' ')}.`, data: { residentId: String(r._id), route: 'residents' }, event: 'resident:requested' });
    const [out] = await withSociety([shape(await Resident.findOne({ _id: r._id, societyId: input.societyId }).populate(populate))]);
    return out;
  },
  async mine(userId: string) {
    const list: any[] = await Resident.find({ userId, status: { $ne: ResidentStatus.MOVED_OUT } }, null, { skipTenantCheck: true }).sort({ createdAt: -1 }).populate(populate);
    return withSociety(list.map(shape));
  },

  async tenants(societyId: string, ctxResidents: { id: string; flatId: string; residentType: string }[]) {
    const owned = ctxResidents.filter((r) => r.residentType === ResidentType.OWNER);
    if (!owned.length) return [];
    const list: any[] = await Resident.find({ societyId, residentType: ResidentType.TENANT, status: ResidentStatus.APPROVED, $or: [{ ownerResidentId: { $in: owned.map((o) => o.id) } }, { flatId: { $in: owned.map((o) => o.flatId) } }] }).sort({ approvedAt: -1 }).populate(populate);
    return list.map(shape).map((j: any) => ({ residentId: j.id, userId: j.userId, name: j.user?.name ?? 'Tenant', mobile: j.user?.mobile, email: j.user?.email, flatId: j.flatId, flatLabel: j.flat?.label, towerName: j.tower?.name, status: j.status, approvedAt: j.approvedAt, moveInDate: j.moveInDate }));
  },
  async addDocument(userId: string, id: string, doc: { type: string; fileId: string }) {
    const r: any = await Resident.findOne({ _id: id, userId, status: ResidentStatus.PENDING }, null, { skipTenantCheck: true });
    if (!r) throw ApiError.notFound('Pending request not found');
    if (!(await File.exists({ _id: doc.fileId, societyId: r.societyId, uploadedBy: userId }))) throw ApiError.badRequest('Document file not found', 'FILE_NOT_FOUND');
    await Resident.updateOne({ _id: id, societyId: r.societyId }, { $push: { verificationDocs: doc } });
    return shape(await Resident.findOne({ _id: id, societyId: r.societyId }).populate(populate));
  },
  async cancel(userId: string, id: string) {
    const r: any = await Resident.findOneAndUpdate({ _id: id, userId, status: ResidentStatus.PENDING }, { $set: { status: ResidentStatus.INACTIVE, isDeleted: true } }, { skipTenantCheck: true } as any);
    if (!r) throw ApiError.notFound('Pending request not found');
  },
  async updateProfile(userId: string, body: any) {
    if (body.email && (await User.exists({ _id: { $ne: userId }, email: body.email.toLowerCase() }))) throw ApiError.conflict('Email is already in use', 'EMAIL_EXISTS');
    const set: Record<string, unknown> = { ...body };
    if (body.email) (set.email = body.email.toLowerCase()), (set.isEmailVerified = false);
    return User.findByIdAndUpdate(userId, { $set: set }, { new: true, runValidators: true });
  },
  async updatePrefs(userId: string, prefs: Record<string, boolean>) {
    const set: Record<string, boolean> = {};
    Object.entries(prefs).forEach(([k, v]) => (set[`notificationPrefs.${k}`] = v));
    return User.findByIdAndUpdate(userId, { $set: set }, { new: true });
  },
};

export const familyService = createCrudService({ model: FamilyMember, name: 'Family member', searchFields: ['name'], filterable: ['flatId'], sortable: ['name', 'createdAt'] });
export const moveService = createCrudService({ model: MoveRequest, name: 'Move request', filterable: ['status', 'type'], sortable: ['createdAt', 'date'] });

registerWorkflowEntity(ApprovalEntityType.MOVE_REQUEST, {
  model: MoveRequest,
  ownerField: 'userId',
  label: (d) => `${d.type === 'MOVE_IN' ? 'Move-in' : 'Move-out'} request (${d.date})`,
  summary: (d) => d.notes,
  autoPublish: async () => false,
  onApproved: async (doc, session) => {
    if (doc.type === 'MOVE_OUT') {
      await Resident.updateOne({ _id: doc.residentId, societyId: doc.societyId }, { $set: { status: ResidentStatus.MOVED_OUT, moveOutDate: new Date(doc.date) } }, { session });
      await syncOwnerLinks(String(doc.societyId), String(doc.flatId), session);
      await syncFlatOccupancy(String(doc.societyId), String(doc.flatId), session);
    } else await Resident.updateOne({ _id: doc.residentId, societyId: doc.societyId }, { $set: { moveInDate: new Date(doc.date) } }, { session });
  },
});

export async function submitMoveRequest(societyId: string, userId: string, ctxResidents: { id: string; flatId: string }[], body: any) {
  const res = body.flatId ? ctxResidents.find((r) => r.flatId === body.flatId) : ctxResidents[0];
  if (!res) throw ApiError.forbidden('You do not belong to this flat', 'FLAT_FORBIDDEN');
  const doc: any = await MoveRequest.create({ societyId, userId, residentId: res.id, flatId: res.flatId, type: body.type, date: body.date, notes: body.notes, vehicleDetails: body.vehicleDetails, createdBy: userId });
  return applyTransition(ApprovalEntityType.MOVE_REQUEST, String(doc._id), 'SUBMITTED', { userId, role: 'RESIDENT', societyId });
}
