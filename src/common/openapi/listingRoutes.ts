import { Request, Response } from 'express';
import { ZodObject, ZodType } from 'zod';
import { created, ok, paged } from '../responses/respond';
import { idParam } from '../validators/common';
import { ModuleRouter } from './router';
import { ListingService } from '../../modules/marketplace/listing.factory';
import { reportBody, reportItem, reportQuery, myListingQuery, adminListingUpdate } from '../../modules/marketplace/marketplace.schema';
import { Permission as P } from '../constants/permissions';

export interface ListingRouteConfig {
  path: string;
  name: string;
  svc: ListingService;
  body: ZodObject<any>;
  item: ZodType;
  browseQuery: ZodType;
  adminQuery: ZodType;
  closeVerb: string;
  closeSummary: string;
  adminUpdate?: ZodType;
}

const sid = (r: Request) => r.auth.societyId!;

export function residentListingRoutes(mr: ModuleRouter, c: ListingRouteConfig) {
  const { svc, path, name } = c;
  mr.add({ method: 'post', path, summary: `Create ${name.toLowerCase()} draft`, description: 'Creates a DRAFT. It is not visible to anyone else until submitted and approved by an administrator.', body: c.body, response: c.item, status: 201, handler: async (req: Request, res: Response) => created(res, await svc.create(sid(req), req.auth.userId, req.auth.flatIds, req.valid.body), 'Draft created') })
    .add({ method: 'get', path, summary: `Browse approved ${name.toLowerCase()}s`, description: 'Only APPROVED/PUBLISHED, unexpired, open listings are returned. Seller contact details are never exposed; use in-app chat.', query: c.browseQuery, response: c.item, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.browse(sid(req), req.valid.query)) })
    .add({ method: 'get', path: `${path}/mine`, summary: `My ${name.toLowerCase()}s in every status`, query: myListingQuery, response: c.item, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.mine(sid(req), req.auth.userId, req.valid.query)) })
    .add({ method: 'get', path: `${path}/favourites`, summary: `My saved ${name.toLowerCase()}s`, query: myListingQuery, response: c.item, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.favourites(sid(req), req.auth.userId, req.valid.query)) })
    .add({ method: 'get', path: `${path}/:id`, summary: `Get ${name.toLowerCase()}`, params: idParam, response: c.item, handler: async (req: Request, res: Response) => ok(res, await svc.viewOne(sid(req), req.auth.userId, req.valid.params.id)) })
    .add({ method: 'patch', path: `${path}/:id`, summary: `Update my ${name.toLowerCase()} (draft / changes requested / rejected only)`, params: idParam, body: c.body.partial(), response: c.item, errors: [409], handler: async (req: Request, res: Response) => ok(res, await svc.update(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Updated') })
    .add({ method: 'delete', path: `${path}/:id`, summary: `Delete my ${name.toLowerCase()}`, params: idParam, response: null, errors: [409], handler: async (req: Request, res: Response) => {
      await svc.remove(sid(req), req.auth.userId, req.valid.params.id);
      ok(res, null, 'Deleted');
    } })
    .add({ method: 'post', path: `${path}/:id/submit`, summary: 'Submit for admin approval', description: 'DRAFT/CHANGES_REQUESTED/EXPIRED → SUBMITTED. Admins with approval permission are notified.', params: idParam, response: c.item, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await svc.submit(sid(req), req.auth.userId, req.valid.params.id), 'Submitted for approval') })
    .add({ method: 'post', path: `${path}/:id/withdraw`, summary: 'Withdraw back to DRAFT (to edit a submitted or published listing)', params: idParam, response: c.item, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await svc.withdraw(sid(req), req.auth.userId, req.valid.params.id), 'Withdrawn') })
    .add({ method: 'post', path: `${path}/:id/${c.closeVerb}`, summary: c.closeSummary, params: idParam, response: c.item, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await svc.close(sid(req), req.auth.userId, req.valid.params.id), 'Updated') })
    .add({ method: 'put', path: `${path}/:id/favourite`, summary: 'Save to favourites', params: idParam, response: null, handler: async (req: Request, res: Response) => {
      await svc.favourite(sid(req), req.auth.userId, req.valid.params.id, true);
      ok(res, null, 'Saved');
    } })
    .add({ method: 'delete', path: `${path}/:id/favourite`, summary: 'Remove from favourites', params: idParam, response: null, handler: async (req: Request, res: Response) => {
      await svc.favourite(sid(req), req.auth.userId, req.valid.params.id, false);
      ok(res, null, 'Removed');
    } })
    .add({ method: 'post', path: `${path}/:id/report`, summary: 'Report an inappropriate listing', description: 'Listings reaching the society\'s report threshold are auto-suspended pending review.', params: idParam, body: reportBody, response: null, status: 201, errors: [409], handler: async (req: Request, res: Response) => {
      await svc.report(sid(req), req.auth.userId, req.valid.params.id, req.valid.body);
      created(res, null, 'Report submitted');
    } });
}

export function adminListingRoutes(mr: ModuleRouter, c: ListingRouteConfig) {
  const { svc, path, name } = c;
  const perm = [P.LISTING_MANAGE];
  mr.add({ method: 'get', path, summary: `List all ${name.toLowerCase()}s (any status)`, description: 'status=SUBMITTED shows pending submissions. Approve/reject/request-changes through /api/v1/admin/approvals.', permissions: perm, query: c.adminQuery, response: c.item, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.adminList(sid(req), req.valid.query)) })
    .add({ method: 'get', path: `${path}/reports`, summary: `Reports filed against ${name.toLowerCase()}s`, permissions: perm, query: reportQuery, response: reportItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.reports(sid(req), req.valid.query)) })
    .add({ method: 'get', path: `${path}/:id`, summary: `Get ${name.toLowerCase()} with moderation fields`, permissions: perm, params: idParam, response: c.item, handler: async (req: Request, res: Response) => ok(res, await svc.adminGet(sid(req), req.valid.params.id)) })
    .add({ method: 'patch', path: `${path}/:id`, summary: 'Edit inappropriate content', permissions: perm, params: idParam, body: c.adminUpdate ?? adminListingUpdate, response: c.item, handler: async (req: Request, res: Response) => ok(res, await svc.adminUpdate(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Updated') })
    .add({ method: 'delete', path: `${path}/:id`, summary: 'Remove listing from circulation', permissions: perm, params: idParam, response: null, handler: async (req: Request, res: Response) => {
      await svc.adminDelete(sid(req), req.auth.userId, req.valid.params.id);
      ok(res, null, 'Removed');
    } });
}
