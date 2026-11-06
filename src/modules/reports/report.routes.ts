import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { ModuleRouter } from '../../common/openapi/router';
import { ok } from '../../common/responses/respond';
import { dateOnly } from '../../common/validators/common';
import { reportService } from './report.service';

export const reportRouter = new ModuleRouter('/api/v1/admin/reports', { tag: 'Society Admin - Reports & Audit', roles: [UserType.SOCIETY_ADMIN], societyScoped: true });
const range = z.object({ from: dateOnly.optional(), to: dateOnly.optional() });
reportRouter
  .add({ method: 'get', path: '/overview', summary: 'Society overview analytics', permissions: [P.REPORT_READ], response: z.object({ flats: z.number(), occupiedFlats: z.number(), residents: z.number(), pendingResidents: z.number(), guards: z.number(), openComplaints: z.number(), outstandingDues: z.number(), visitorsToday: z.number() }), handler: async (req: Request, res: Response) => ok(res, await reportService.overview(req.auth.societyId!)) })
  .add({ method: 'get', path: '/visitors', summary: 'Visitor analytics: per-day volume, type split, deliveries', permissions: [P.REPORT_READ], query: range, response: z.object({ perDay: z.array(z.object({ date: z.string(), count: z.number() })), byType: z.record(z.string(), z.number()), deliveries: z.number() }), handler: async (req: Request, res: Response) => ok(res, await reportService.visitors(req.auth.societyId!, req.valid.query)) });
