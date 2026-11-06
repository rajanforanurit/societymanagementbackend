import { Model } from 'mongoose';
import { ApprovalEntityType, ApprovalStatus } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { addDays } from '../../common/utils/dates';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { applyTransition, listingAutoPublish, registerWorkflowEntity, VISIBLE_STATUSES } from '../approvals/approval.service';
import { notifyAdmins } from '../notifications/notify.service';
import { Flat, Society } from '../society/society.model';
import { FavouriteListing, ListingReport } from './marketplace.model';

export const EDITABLE: ApprovalStatus[] = ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'];

export interface ListingConfig {
  model: Model<any>;
  modelName: 'MarketplaceListing' | 'PropertyListing';
  entityType: ApprovalEntityType;
  label: string;
  typeField: string;
  closedField: 'isSold' | 'isClosed';
  searchFields: string[];
  filterable: string[];
  sortable: string[];
}

const actorOf = (societyId: string, userId: string, role = 'RESIDENT') => ({ userId, role, societyId });
const seller = { path: 'sellerId', select: 'name' };

export const createListingService = (c: ListingConfig) => {
  registerWorkflowEntity(c.entityType, {
    model: c.model,
    ownerField: 'sellerId',
    label: (d) => d.title,
    summary: (d) => String(d.description).slice(0, 200),
    autoPublish: listingAutoPublish,
    onApproved: async (doc, session) => {
      const s: any = await Society.findById(doc.societyId).select('settings.listing');
      const days = s?.settings?.listing?.expiryDays ?? 30;
      await c.model.updateOne({ _id: doc._id, societyId: doc.societyId }, { $set: { expiresAt: addDays(new Date(), days), publishedAt: new Date() } }, { session });
    },
  });

  const visible = (societyId: string) => ({ societyId, status: { $in: VISIBLE_STATUSES }, [c.closedField]: false, $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }] });

  const svc = {
    async create(societyId: string, userId: string, flatIds: string[], body: any) {
      let flatId = body.flatId ?? flatIds[0];
      if (flatId && !flatIds.includes(flatId)) throw ApiError.forbidden('You do not belong to this flat', 'FLAT_FORBIDDEN');
      const flat: any = flatId ? await Flat.findOne({ _id: flatId, societyId }) : null;
      return c.model.create({ ...body, flatId, flatLabel: flat?.label, societyId, sellerId: userId, createdBy: userId, status: 'DRAFT' });
    },
    async update(societyId: string, userId: string, id: string, body: any) {
      const doc: any = await c.model.findOne({ _id: id, societyId, sellerId: userId });
      if (!doc) throw ApiError.notFound(`${c.label} not found`);
      if (!EDITABLE.includes(doc.status)) throw ApiError.conflict('Withdraw the listing before editing it', 'NOT_EDITABLE');
      Object.assign(doc, body, { updatedBy: userId });
      await doc.save();
      return doc;
    },
    async remove(societyId: string, userId: string, id: string) {
      const r = await c.model.findOneAndUpdate({ _id: id, societyId, sellerId: userId, status: { $in: [...EDITABLE, 'EXPIRED', 'REMOVED'] } }, { $set: { isDeleted: true, deletedAt: new Date() } });
      if (!r) throw ApiError.conflict('Only draft, rejected, expired or removed listings can be deleted. Withdraw it first.', 'NOT_DELETABLE');
    },
    async submit(societyId: string, userId: string, id: string) {
      const doc: any = await applyTransition(c.entityType, id, 'SUBMITTED', actorOf(societyId, userId), { ownerOnly: true });
      await notifyAdmins(societyId, 'approval:review', { type: 'APPROVAL', title: `New ${c.label.toLowerCase()} awaiting approval`, body: doc.title, data: { entityType: c.entityType, entityId: id }, event: 'approval:submitted' });
      return doc;
    },
    withdraw: (societyId: string, userId: string, id: string) => applyTransition(c.entityType, id, 'DRAFT', actorOf(societyId, userId), { ownerOnly: true }),
    async mine(societyId: string, userId: string, q: any) {
      const f: Record<string, unknown> = { societyId, sellerId: userId };
      if (q.status) f.status = q.status;
      return paginate(c.model, applyListFilters(f, q, c.searchFields), q, { sortable: c.sortable });
    },
    async browse(societyId: string, q: any) {
      const f: Record<string, any> = visible(societyId);
      c.filterable.forEach((k) => q[k] !== undefined && (f[k] = q[k]));
      if (q.minPrice !== undefined || q.maxPrice !== undefined) f.price = { ...(q.minPrice !== undefined ? { $gte: q.minPrice } : {}), ...(q.maxPrice !== undefined ? { $lte: q.maxPrice } : {}) };
      return paginate(c.model, applyListFilters(f, q, c.searchFields), q, { sortable: c.sortable, populate: seller });
    },
    async viewOne(societyId: string, userId: string, id: string) {
      const doc: any = await c.model.findOne({ _id: id, societyId, $or: [{ sellerId: userId }, visible(societyId)] }).populate(seller);
      if (!doc) throw ApiError.notFound(`${c.label} not found`);
      if (String(doc.sellerId?._id ?? doc.sellerId) !== userId) await c.model.updateOne({ _id: id, societyId }, { $inc: { viewCount: 1 } });
      return doc;
    },
    async close(societyId: string, userId: string, id: string) {
      const set: Record<string, unknown> = { [c.closedField]: true, updatedBy: userId };
      if (c.closedField === 'isSold') set.soldAt = new Date();
      else set.closedAt = new Date();
      const r = await c.model.findOneAndUpdate({ _id: id, societyId, sellerId: userId, status: { $in: VISIBLE_STATUSES } }, { $set: set }, { new: true });
      if (!r) throw ApiError.conflict('Only published listings can be closed', 'INVALID_STATE');
      return r;
    },
    async favourite(societyId: string, userId: string, id: string, on: boolean) {
      if (!(await c.model.exists({ _id: id, societyId, ...(on ? { status: { $in: VISIBLE_STATUSES } } : {}) }))) throw ApiError.notFound(`${c.label} not found`);
      if (on) {
        const r = await FavouriteListing.updateOne({ societyId, userId, listingId: id }, { $setOnInsert: { listingModel: c.modelName } }, { upsert: true });
        if (r.upsertedCount) await c.model.updateOne({ _id: id, societyId }, { $inc: { favouriteCount: 1 } });
      } else {
        const r = await FavouriteListing.deleteOne({ societyId, userId, listingId: id });
        if (r.deletedCount) await c.model.updateOne({ _id: id, societyId }, { $inc: { favouriteCount: -1 } });
      }
    },
    async favourites(societyId: string, userId: string, q: any) {
      const favs: any[] = await FavouriteListing.find({ societyId, userId, listingModel: c.modelName }).select('listingId');
      return paginate(c.model, { _id: { $in: favs.map((f) => f.listingId) }, ...visible(societyId) }, q, { sortable: c.sortable, populate: seller });
    },
    async report(societyId: string, userId: string, id: string, body: { reason: string; details?: string }) {
      const doc: any = await c.model.findOne({ _id: id, societyId, status: { $in: VISIBLE_STATUSES } });
      if (!doc) throw ApiError.notFound(`${c.label} not found`);
      if (String(doc.sellerId) === userId) throw ApiError.badRequest('You cannot report your own listing');
      try {
        await ListingReport.create({ societyId, listingId: id, listingModel: c.modelName, reportedBy: userId, ...body });
      } catch (e: any) {
        if (e?.code === 11000) throw ApiError.conflict('You have already reported this listing', 'ALREADY_REPORTED');
        throw e;
      }
      const updated: any = await c.model.findOneAndUpdate({ _id: id, societyId }, { $inc: { reportCount: 1 } }, { new: true });
      const s: any = await Society.findById(societyId).select('settings.listing');
      const threshold = s?.settings?.listing?.reportSuspendThreshold ?? 3;
      if (updated.reportCount >= threshold && VISIBLE_STATUSES.includes(updated.status)) {
        await applyTransition(c.entityType, id, 'SUSPENDED', { userId, role: 'SYSTEM', societyId }, { reason: `Auto-suspended after ${updated.reportCount} reports` }).catch(() => undefined);
        await notifyAdmins(societyId, 'approval:review', { type: 'APPROVAL', title: 'Listing auto-suspended', body: updated.title, data: { entityType: c.entityType, entityId: id } });
      }
    },
    async adminList(societyId: string, q: any) {
      const f: Record<string, any> = { societyId };
      if (q.status) f.status = q.status;
      c.filterable.forEach((k) => q[k] !== undefined && (f[k] = q[k]));
      return paginate(c.model, applyListFilters(f, q, c.searchFields), q, { sortable: c.sortable, populate: seller });
    },
    async adminGet(societyId: string, id: string) {
      const doc = await c.model.findOne({ _id: id, societyId }).populate(seller);
      if (!doc) throw ApiError.notFound(`${c.label} not found`);
      return doc;
    },
    async adminUpdate(societyId: string, userId: string, id: string, body: any) {
      const doc = await c.model.findOneAndUpdate({ _id: id, societyId }, { $set: { ...body, updatedBy: userId } }, { new: true, runValidators: true });
      if (!doc) throw ApiError.notFound(`${c.label} not found`);
      return doc;
    },
    async adminDelete(societyId: string, userId: string, id: string) {
      const doc: any = await c.model.findOne({ _id: id, societyId });
      if (!doc) throw ApiError.notFound(`${c.label} not found`);
      if (doc.status !== 'REMOVED') await applyTransition(c.entityType, id, 'REMOVED', { userId, role: 'SOCIETY_ADMIN', societyId }, {}).catch(async () => {
        await c.model.updateOne({ _id: id, societyId }, { $set: { status: 'REMOVED' } });
      });
    },
    async expireDue() {
      const due: any[] = await c.model.find({ status: { $in: VISIBLE_STATUSES }, expiresAt: { $lt: new Date() } }).setOptions({ skipTenantCheck: true }).limit(200);
      for (const d of due) await applyTransition(c.entityType, String(d._id), 'EXPIRED', { userId: String(d.sellerId), role: 'SYSTEM', societyId: String(d.societyId) }, {}).catch(() => undefined);
    },
    async reports(societyId: string, q: any) {
      const f: Record<string, unknown> = { societyId, listingModel: c.modelName };
      if (q.status) f.status = q.status;
      return paginate(ListingReport, f, q, { sortable: ['createdAt'] });
    },
  };
  return svc;
};
export type ListingService = ReturnType<typeof createListingService>;
