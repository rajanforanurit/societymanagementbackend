import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { idParam } from '../../common/validators/common';
import * as s from './complaint.schema';
import { complaintService as c } from './complaint.service';

const sid = (r: Request) => r.auth.societyId!;

export const complaintResidentRouter = new ModuleRouter('/api/v1/user/complaints', {
  tag: 'Resident - Helpdesk',
  tagDescription: 'Raise and track complaints, chat with assigned staff, reopen and rate service quality',
  roles: [UserType.RESIDENT],
  societyScoped: true,
  feature: 'complaints',
});
complaintResidentRouter
  .add({ method: 'post', path: '/', summary: 'Raise a complaint', description: 'Categories: water, electricity, lift, cleanliness, security, plumbing, parking, noise, garden, other. Upload attachments first via /api/v1/files.', body: s.raiseBody, response: s.complaintItem, status: 201, handler: async (req: Request, res: Response) => created(res, await c.raise(sid(req), req.auth.userId, req.auth.residents, req.valid.body), 'Complaint raised') })
  .add({ method: 'get', path: '/', summary: 'My complaints', query: s.complaintQuery, response: s.complaintItem.omit({ comments: true, history: true }), paginated: true, handler: async (req: Request, res: Response) => paged(res, await c.listMine(sid(req), req.auth.userId, req.auth.flatIds, req.valid.query)) })
  .add({ method: 'get', path: '/:id', summary: 'Complaint status, history and public comments', description: 'Internal admin notes are never returned.', params: idParam, response: s.complaintItem, handler: async (req: Request, res: Response) => ok(res, await c.getMine(sid(req), req.auth.userId, req.auth.flatIds, req.valid.params.id)) })
  .add({ method: 'post', path: '/:id/comments', summary: 'Communicate with the assigned staff', params: idParam, body: s.residentCommentBody, response: s.complaintItem, status: 201, handler: async (req: Request, res: Response) => created(res, await c.comment(sid(req), { userId: req.auth.userId, role: 'RESIDENT', flatIds: req.auth.flatIds }, req.valid.params.id, req.valid.body, false), 'Comment added') })
  .add({ method: 'post', path: '/:id/reopen', summary: 'Reopen a resolved complaint (within 7 days)', params: idParam, body: s.reopenBody, response: s.complaintItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await c.reopen(sid(req), req.auth.userId, req.auth.flatIds, req.valid.params.id, req.valid.body.reason), 'Complaint reopened') })
  .add({ method: 'post', path: '/:id/rate', summary: 'Rate service quality', params: idParam, body: s.rateBody, response: s.complaintItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await c.rate(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Thanks for your feedback') });

export const complaintAdminRouter = new ModuleRouter('/api/v1/admin/complaints', {
  tag: 'Society Admin - Helpdesk',
  tagDescription: 'Complaint triage, assignment to staff/vendors, SLAs, escalation, internal notes and reports',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
  feature: 'complaints',
});
const read = [P.COMPLAINT_READ];
const manage = [P.COMPLAINT_MANAGE];
complaintAdminRouter
  .add({ method: 'get', path: '/', summary: 'List all complaints', query: s.adminComplaintQuery, permissions: read, response: s.complaintItem.omit({ comments: true, history: true }), paginated: true, handler: async (req: Request, res: Response) => paged(res, await c.adminList(sid(req), req.valid.query)) })
  .add({ method: 'get', path: '/reports/summary', summary: 'Complaint report: status/category breakdown, overdue count, resolution time, satisfaction', permissions: [P.REPORT_READ], query: s.reportQuery, response: s.complaintReport, handler: async (req: Request, res: Response) => ok(res, await c.report(sid(req), req.valid.query)) })
  .add({ method: 'get', path: '/:id', summary: 'Complaint with internal notes and full history', permissions: read, params: idParam, response: s.complaintItem, handler: async (req: Request, res: Response) => ok(res, await c.adminGet(sid(req), req.valid.params.id)) })
  .add({ method: 'patch', path: '/:id', summary: 'Update status, priority or SLA', permissions: manage, params: idParam, body: s.adminUpdateBody, response: s.complaintItem, errors: [409], handler: async (req: Request, res: Response) => ok(res, await c.adminUpdate(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Complaint updated') })
  .add({ method: 'post', path: '/:id/assign', summary: 'Assign to staff, vendor or admin and optionally set a deadline', permissions: manage, params: idParam, body: s.assignBody, response: s.complaintItem, status: 200, errors: [404, 409], handler: async (req: Request, res: Response) => ok(res, await c.assign(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Complaint assigned') })
  .add({ method: 'post', path: '/:id/escalate', summary: 'Escalate an unresolved complaint', permissions: manage, params: idParam, body: s.escalateBody, response: s.complaintItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await c.escalate(sid(req), req.auth.userId, req.valid.params.id, req.valid.body.reason), 'Complaint escalated') })
  .add({ method: 'post', path: '/:id/comments', summary: 'Add a public reply or internal note', permissions: manage, params: idParam, body: s.commentBody, response: s.complaintItem, status: 201, handler: async (req: Request, res: Response) => created(res, await c.comment(sid(req), { userId: req.auth.userId, role: 'SOCIETY_ADMIN' }, req.valid.params.id, req.valid.body, true), 'Comment added') })
  .add({ method: 'get', path: '/:id/assignments', summary: 'Assignment history', permissions: read, params: idParam, response: z.array(z.object({ id: z.string(), assigneeType: z.string(), assigneeId: z.string(), assigneeName: z.string().optional(), active: z.boolean() })), handler: async (req: Request, res: Response) => ok(res, await c.history(sid(req), req.valid.params.id)) });
