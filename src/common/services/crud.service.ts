import { ClientSession, Model } from 'mongoose';
import { ApiError } from '../utils/apiError';
import { applyListFilters, paginate, toDotPaths, ListQuery } from '../utils/pagination';

export interface CrudConfig {
  model: Model<any>;
  name: string;
  searchFields?: string[];
  sortable?: string[];
  filterable?: string[];
  populate?: any;
  select?: string;
  defaultSort?: string;
  beforeRemove?: (societyId: string, id: string) => Promise<void>;
}

export const createCrudService = (cfg: CrudConfig) => {
  const { model, name } = cfg;
  const buildFilter = (societyId: string, query: Record<string, any>, scope: Record<string, any>) => {
    const f: Record<string, any> = { societyId, ...scope };
    (cfg.filterable ?? []).forEach((k) => {
      if (query[k] !== undefined) f[k] = query[k];
    });
    return applyListFilters(f, query as ListQuery, cfg.searchFields);
  };
  const service = {
    model,
    async list(societyId: string, query: Record<string, any>, scope: Record<string, any> = {}) {
      return paginate(model, buildFilter(societyId, query, scope), query, {
        sortable: cfg.sortable,
        populate: cfg.populate,
        select: cfg.select,
        defaultSort: cfg.defaultSort,
      });
    },
    async get(societyId: string, id: string, scope: Record<string, any> = {}) {
      let q = model.findOne({ _id: id, societyId, ...scope });
      if (cfg.populate) q = q.populate(cfg.populate);
      const doc = await q;
      if (!doc) throw ApiError.notFound(`${name} not found`);
      return doc;
    },
    async create(societyId: string, actorId: string | undefined, data: Record<string, any>, session?: ClientSession) {
      const [doc] = await model.create([{ ...data, societyId, createdBy: actorId, updatedBy: actorId }], { session });
      return doc;
    },
    async update(societyId: string, id: string, actorId: string | undefined, data: Record<string, any>, scope: Record<string, any> = {}) {
      const doc = await model.findOneAndUpdate(
        { _id: id, societyId, ...scope },
        { $set: { ...toDotPaths(data), updatedBy: actorId } },
        { new: true, runValidators: true },
      );
      if (!doc) throw ApiError.notFound(`${name} not found`);
      return doc;
    },
    async remove(societyId: string, id: string, actorId: string | undefined, scope: Record<string, any> = {}) {
      if (cfg.beforeRemove) await cfg.beforeRemove(societyId, id);
      const doc = await model.findOneAndUpdate(
        { _id: id, societyId, ...scope },
        { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actorId } },
        { new: true },
      );
      if (!doc) throw ApiError.notFound(`${name} not found`);
      return doc;
    },
  };
  return service;
};

export type CrudService = ReturnType<typeof createCrudService>;
