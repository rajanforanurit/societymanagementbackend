import { Request, Response } from 'express';
import { Model } from 'mongoose';
import { ApiError } from '../utils/apiError';
import { created, ok, paged } from '../responses/respond';
import { applyListFilters, paginate, toDotPaths } from '../utils/pagination';
import { CrudController } from './crud.controller';

export interface GlobalCrudConfig {
  model: Model<any>;
  name: string;
  label: string;
  searchFields?: string[];
  filterable?: string[];
  sortable?: string[];
  prepare?: (body: any) => any;
}

export const globalCrudController = (c: GlobalCrudConfig): CrudController => ({
  list: async (req: Request, res: Response) => {
    const q = req.valid.query;
    const f: Record<string, unknown> = {};
    (c.filterable ?? []).forEach((k) => q[k] !== undefined && (f[k] = q[k]));
    paged(res, await paginate(c.model, applyListFilters(f, q, c.searchFields), q, { sortable: c.sortable }));
  },
  get: async (req: Request, res: Response) => {
    const d = await c.model.findById(req.valid.params.id);
    if (!d) throw ApiError.notFound(`${c.name} not found`);
    ok(res, d);
  },
  create: async (req: Request, res: Response) => created(res, await c.model.create({ ...(c.prepare ? c.prepare(req.valid.body) : req.valid.body), createdBy: req.auth.userId }), `${c.label} created`),
  update: async (req: Request, res: Response) => {
    const d = await c.model.findByIdAndUpdate(req.valid.params.id, { $set: { ...toDotPaths(req.valid.body), updatedBy: req.auth.userId } }, { new: true, runValidators: true });
    if (!d) throw ApiError.notFound(`${c.name} not found`);
    ok(res, d, `${c.label} updated`);
  },
  remove: async (req: Request, res: Response) => {
    const d = await c.model.findByIdAndUpdate(req.valid.params.id, { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: req.auth.userId } });
    if (!d) throw ApiError.notFound(`${c.name} not found`);
    ok(res, null, `${c.label} deleted`);
  },
});
