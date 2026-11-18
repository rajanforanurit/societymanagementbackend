import { ApiError } from '../../common/utils/apiError';
import { createCrudService } from '../../common/services/crud.service';
import { oid } from '../../common/utils/objectId';
import { realtime } from '../../realtime/socket';
import { normalizeMobile } from '../auth/auth.service';
import { HelpdeskContact } from './helpdesk.model';
import { HELPDESK_CATEGORIES } from './helpdesk.schema';

const base = createCrudService({
  model: HelpdeskContact,
  name: 'Helpdesk contact',
  searchFields: ['name', 'mobile', 'category', 'designation'],
  filterable: ['category', 'isVisible'],
  sortable: ['category', 'order', 'name', 'createdAt'],
  defaultSort: 'category,order,name',
});

const changed = (societyId: string, action: string, id?: string) => realtime.toSociety(societyId, 'helpdesk:changed', { action, id });
const clean = (b: Record<string, any>): Record<string, any> => ({ ...b, ...(b.mobile ? { mobile: normalizeMobile(b.mobile) } : {}), ...(b.alternateMobile ? { alternateMobile: normalizeMobile(b.alternateMobile) } : {}) });

export const helpdeskService = {
  ...base,
  async create(societyId: string, actorId: string | undefined, data: Record<string, any>) {
    const body = clean(data);
    if (await HelpdeskContact.exists({ societyId, mobile: body.mobile, category: body.category })) throw ApiError.conflict('This person is already listed in that category', 'HELPDESK_DUPLICATE');
    const doc = await base.create(societyId, actorId, body);
    changed(societyId, 'created', String((doc as any)._id));
    return doc;
  },
  async update(societyId: string, id: string, actorId: string | undefined, data: Record<string, any>, scope: Record<string, any> = {}) {
    const doc = await base.update(societyId, id, actorId, clean(data), scope);
    changed(societyId, 'updated', id);
    return doc;
  },
  async remove(societyId: string, id: string, actorId: string | undefined, scope: Record<string, any> = {}) {
    const doc = await base.remove(societyId, id, actorId, scope);
    changed(societyId, 'deleted', id);
    return doc;
  },
  /** Contacts residents and guards may see (hidden entries stay admin-only). */
  async listVisible(societyId: string, query: Record<string, any>) {
    const r = await base.list(societyId, query, { isVisible: true });
    return { ...r, items: r.items.map((c: any) => ({ id: String(c._id), name: c.name, mobile: c.mobile, alternateMobile: c.alternateMobile, category: c.category, designation: c.designation, description: c.description, availability: c.availability })) };
  },
  async categories(societyId: string, visibleOnly: boolean) {
    const rows: any[] = await HelpdeskContact.aggregate([{ $match: { societyId: oid(societyId), ...(visibleOnly ? { isVisible: true } : {}) } }, { $group: { _id: '$category', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]);
    if (visibleOnly) return rows.map((r) => ({ category: r._id as string, count: r.count as number }));
    const used = new Map(rows.map((r) => [r._id as string, r.count as number]));
    return [...new Set([...HELPDESK_CATEGORIES, ...used.keys()])].map((category) => ({ category, count: used.get(category) ?? 0 }));
  },
};
