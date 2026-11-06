import { Model } from 'mongoose';
import { endOfDay } from './dates';
import { PageResult } from '../responses/respond';

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const parseSort = (raw: string | undefined, allowed: string[], fallback: string) => {
  const fields = (raw ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => allowed.includes(s.replace(/^-/, '')));
  const list = fields.length ? fields : [fallback];
  const sort: Record<string, 1 | -1> = {};
  list.forEach((f) => {
    sort[f.replace(/^-/, '')] = f.startsWith('-') ? -1 : 1;
  });
  sort._id = -1;
  return sort;
};

export interface ListQuery {
  page?: number;
  limit?: number;
  sort?: string;
  search?: string;
  from?: string;
  to?: string;
}

export const applyListFilters = (filter: Record<string, any>, q: ListQuery, searchFields: string[] = []) => {
  const out = { ...filter };
  if (q.search && searchFields.length) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    out.$and = [...(out.$and ?? []), { $or: searchFields.map((f) => ({ [f]: rx })) }];
  }
  if (q.from || q.to) {
    out.createdAt = {
      ...(q.from ? { $gte: new Date(q.from) } : {}),
      ...(q.to ? { $lte: endOfDay(q.to) } : {}),
    };
  }
  return out;
};

export async function paginate(
  model: Model<any>,
  filter: Record<string, any>,
  q: ListQuery,
  o: { sortable?: string[]; defaultSort?: string; populate?: any; select?: string; skipTenant?: boolean } = {},
): Promise<PageResult> {
  const page = q.page ?? 1;
  const limit = q.limit ?? 20;
  const sort = parseSort(q.sort, o.sortable ?? ['createdAt', 'updatedAt'], o.defaultSort ?? '-createdAt');
  let query = model
    .find(filter)
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(limit);
  if (o.skipTenant) query = query.setOptions({ skipTenantCheck: true });
  if (o.select) query = query.select(o.select);
  if (o.populate) query = query.populate(o.populate);
  const [items, total] = await Promise.all([query.exec(), (o.skipTenant ? model.countDocuments(filter).setOptions({ skipTenantCheck: true }) : model.countDocuments(filter))]);
  return { items, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

export const toDotPaths = (obj: Record<string, any>, prefix = ''): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && Object.getPrototypeOf(v) === Object.prototype) {
      Object.assign(out, toDotPaths(v, key));
    } else out[key] = v;
  }
  return out;
};
