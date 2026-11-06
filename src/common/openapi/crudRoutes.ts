import { z, ZodObject, ZodType } from 'zod';
import { entity } from '../responses/schemas';
import { CrudController } from '../services/crud.controller';
import { idParam } from '../validators/common';
import { ModuleRouter, RouteDef } from './router';

export interface CrudRouteConfig {
  path: string;
  name: string;
  plural?: string;
  controller: CrudController;
  create?: ZodObject<any>;
  update?: ZodType;
  query: ZodType;
  item: ZodType;
  read?: string[];
  write?: string[];
  remove?: boolean;
  feature?: RouteDef['feature'];
  tag?: string;
}

export function crudRoutes(mr: ModuleRouter, c: CrudRouteConfig) {
  const plural = c.plural ?? `${c.name}s`;
  const base = { tag: c.tag, feature: c.feature };
  const idPath = `${c.path === '/' ? '' : c.path}/:id`;
  mr.add({ ...base, method: 'get', path: c.path, summary: `List ${plural.toLowerCase()}`, description: 'Supports pagination (page, limit), sorting (sort=-createdAt), search and filters.', permissions: c.read, query: c.query, response: c.item, paginated: true, handler: c.controller.list });
  mr.add({ ...base, method: 'get', path: idPath, summary: `Get ${c.name.toLowerCase()} by id`, permissions: c.read, params: idParam, response: c.item, handler: c.controller.get });
  if (c.create) mr.add({ ...base, method: 'post', path: c.path, summary: `Create ${c.name.toLowerCase()}`, permissions: c.write, body: c.create, response: c.item, status: 201, errors: [409], handler: c.controller.create });
  const upd = c.update ?? c.create?.partial();
  if (upd) mr.add({ ...base, method: 'patch', path: idPath, summary: `Update ${c.name.toLowerCase()}`, description: 'Partial update. Nested objects are merged field by field; arrays are replaced.', permissions: c.write, params: idParam, body: upd, response: c.item, errors: [409], handler: c.controller.update });
  if (c.remove !== false && (c.create || c.update)) mr.add({ ...base, method: 'delete', path: idPath, summary: `Delete ${c.name.toLowerCase()}`, description: 'Soft delete; the record is retained for audit.', permissions: c.write, params: idParam, response: null, errors: [409], handler: c.controller.remove });
  return mr;
}

export const itemSchema = <T extends z.ZodRawShape>(shape: T) => entity(shape);
