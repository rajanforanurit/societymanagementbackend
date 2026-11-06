import { Request, Response } from 'express';
import { created, ok, paged } from '../responses/respond';
import { CrudService } from './crud.service';

export interface CrudControllerOptions {
  scope?: (req: Request) => Record<string, any>;
  prepare?: (req: Request, body: Record<string, any>) => Record<string, any>;
  label: string;
}

export const crudController = (service: CrudService, opts: CrudControllerOptions) => ({
  list: async (req: Request, res: Response) =>
    paged(res, await service.list(req.auth.societyId!, req.valid.query, opts.scope?.(req) ?? {})),
  get: async (req: Request, res: Response) =>
    ok(res, await service.get(req.auth.societyId!, req.valid.params.id, opts.scope?.(req) ?? {})),
  create: async (req: Request, res: Response) => {
    const body = opts.prepare ? opts.prepare(req, req.valid.body) : req.valid.body;
    created(res, await service.create(req.auth.societyId!, req.auth.userId, body), `${opts.label} created`);
  },
  update: async (req: Request, res: Response) =>
    ok(res, await service.update(req.auth.societyId!, req.valid.params.id, req.auth.userId, req.valid.body, opts.scope?.(req) ?? {}), `${opts.label} updated`),
  remove: async (req: Request, res: Response) => {
    await service.remove(req.auth.societyId!, req.valid.params.id, req.auth.userId, opts.scope?.(req) ?? {});
    ok(res, null, `${opts.label} deleted`);
  },
});

export type CrudController = Record<'list' | 'get' | 'create' | 'update' | 'remove', (req: Request, res: Response) => Promise<unknown>>;
