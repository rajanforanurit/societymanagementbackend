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

const populate = [{ path: 'userId', select: 'name mobile email' }, { path: 'flatId', select: 'label' }];
const shape = (r: any) => {
  const j = r.toJSON();
  if (j.userId && typeof j.userId === 'object') (j.user = j.userId), (j.userId = j.user.id);
  if (j.flatId && typeof j.flatId === 'object') (j.flat = j.flatId), (j.flatId = j.flat.id);
  return j;
};

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
      const doc: any = await Resident.findOneAndUpdate({ _id: id, societyId, status: ResidentStatus.PENDING }, { $set: { status: ResidentStatus.APPROVED, approvedBy: actorId, approvedAt: new Date(), moveInDate: new Date(), updatedBy: actorId }, $unset: { rejectionReason: 1 } }, { new: true, session });
      if (!doc) throw ApiError.conflict('Only PENDING registrations can be approved', 'INVALID_STATE');
      const hasPrimary = await Resident.exists({ societyId, flatId: doc.flatId, status: ResidentStatus.APPROVED, isPrimary: true, _id: { $ne: doc._id } }).session(session ?? null);
      if (!hasPrimary && doc.residentType !== ResidentType.FAMILY_MEMBER) await Resident.updateOne({ _id: doc._id, societyId }, { $set: { isPrimary: true } }, { session });
      if (doc.residentType === ResidentType.OWNER) await Flat.updateOne({ _id: doc.flatId, societyId }, { $set: { ownerResidentId: doc._id } }, { session });
      await syncFlatOccupancy(societyId, String(doc.flatId), session);
      await writeAudit({ actorId, actorRole: 'SOCIETY_ADMIN', societyId, action: 'RESIDENT_APPROVED', entityType: 'Resident', entityId: id }, session);
      return doc;
    });
    await notifyUsers({ societyId, userIds: [r.userId], type: NotificationType.APPROVAL, title: 'Residency approved', body: 'Your society membership has been approved. Switch to the society to get started.', data: { residentId: id }, event: 'resident:approved' });
    return residentAdmin.get(societyId, id);
  },
  async reject(societyId: string, id: string, actorId: string, reason: string) {
    const doc: any = await Resident.findOneAndUpdate({ _id: id, societyId, status: ResidentStatus.PENDING }, { $set: { status: ResidentStatus.REJECTED, rejectionReason: reason, updatedBy: actorId } }, { new: true });
    if (!doc) throw ApiError.conflict('Only PENDING registrations can be rejected', 'INVALID_STATE');
    await writeAudit({ actorId, actorRole: 'SOCIETY_ADMIN', societyId, action: 'RESIDENT_REJECTED', entityType: 'Resident', entityId: id, metadata: { reason } });
    await notifyUsers({ societyId, userIds: [doc.userId], type: NotificationType.APPROVAL, title: 'Residency request rejected', body: reason, data: { residentId: id } });
    return residentAdmin.get(societyId, id);
  },
  async setActive(societyId: string, id: string, actorId: string, active: boolean) {
    const from = active ? ResidentStatus.INACTIVE : ResidentStatus.APPROVED;
    const to = active ? ResidentStatus.APPROVED : ResidentStatus.INACTIVE;
    const doc: any = await Resident.findOneAndUpdate({ _id: id, societyId, status: from }, { $set: { status: to, updatedBy: actorId } }, { new: true });
    if (!doc) throw ApiError.conflict(`Resident must be ${from} to perform this action`, 'INVALID_STATE');
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
    await Resident.updateOne({ _id: id, societyId }, { $set: set }, { runValidators: true });
    if (body.flatId && String(before.flatId) !== body.flatId) {
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
    const exists = await Resident.exists({ societyId: input.societyId, userId, flatId: input.flatId, status: { $in: [ResidentStatus.PENDING, ResidentStatus.APPROVED] } });
    if (exists) throw ApiError.conflict('You already have a pending or approved request for this flat', 'REQUEST_EXISTS');
    const r: any = await Resident.create({ societyId: input.societyId, userId, flatId: input.flatId, residentType: input.residentType, relationToPrimary: input.relationToPrimary, verificationDocs: input.documents, tenancy: input.tenancy, createdBy: userId });
    await notifyAdmins(input.societyId, 'resident:approve', { type: NotificationType.APPROVAL, title: 'New residency request', body: `A new ${input.residentType.toLowerCase()} registration for ${flat.label} awaits review.`, data: { residentId: String(r._id) }, event: 'resident:requested' });
    return shape(await r.populate(populate));
  },
  async mine(userId: string) {
    const list: any[] = await Resident.find({ userId, status: { $ne: ResidentStatus.MOVED_OUT } }, null, { skipTenantCheck: true }).populate(populate);
    return list.map(shape);
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
