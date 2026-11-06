import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { crudController } from '../../common/services/crud.controller';
import { idParam, listQuery } from '../../common/validators/common';
import * as s from './community.schema';
import { directory, noticeExtra, noticeService, pollExtra, pollService, postService, shapePoll } from './community.service';

const sid = (r: Request) => r.auth.societyId!;

export const communityAdminRouter = new ModuleRouter('/api/v1/admin', {
  tag: 'Society Admin - Communication',
  tagDescription: 'Notice board, emergency announcements, polls, surveys, elections and community post moderation',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
  feature: 'community',
});
crudRoutes(communityAdminRouter, { path: '/notices', name: 'Notice', controller: crudController(noticeService, { label: 'Notice', prepare: (r, b) => ({ ...b, authorId: r.auth.userId, status: 'DRAFT' }) }), create: s.noticeBody, query: s.noticeQuery, item: s.noticeItem, read: [P.NOTICE_MANAGE], write: [P.NOTICE_MANAGE] });
communityAdminRouter
  .add({ method: 'post', path: '/notices/:id/publish', summary: 'Publish a notice and push-notify the targeted residents', description: 'Audience can target the whole society, specific towers or specific flats. EMERGENCY notices bypass notification preferences.', permissions: [P.NOTICE_MANAGE], params: idParam, response: s.noticeItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await noticeExtra.publish(sid(req), req.auth.userId, req.valid.params.id), 'Notice published') })
  .add({ method: 'post', path: '/notices/:id/archive', summary: 'Archive a notice', permissions: [P.NOTICE_MANAGE], params: idParam, response: s.noticeItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await noticeExtra.archive(sid(req), req.auth.userId, req.valid.params.id), 'Notice archived') });
crudRoutes(communityAdminRouter, { path: '/polls', name: 'Poll', controller: crudController(pollService, { label: 'Poll', prepare: (_r, b) => ({ ...b, status: 'DRAFT' }) }), create: s.pollBody, query: s.pollQuery, item: s.pollItem, read: [P.POLL_MANAGE], write: [P.POLL_MANAGE] });
communityAdminRouter
  .add({ method: 'post', path: '/polls/:id/activate', summary: 'Open a poll, survey or election for voting', permissions: [P.POLL_MANAGE], params: idParam, response: s.pollItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, shapePoll(await pollExtra.setStatus(sid(req), req.auth.userId, req.valid.params.id, 'ACTIVE')), 'Poll opened') })
  .add({ method: 'post', path: '/polls/:id/close', summary: 'Close voting', permissions: [P.POLL_MANAGE], params: idParam, response: s.pollItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, shapePoll(await pollExtra.setStatus(sid(req), req.auth.userId, req.valid.params.id, 'CLOSED')), 'Poll closed') })
  .add({ method: 'get', path: '/polls/:id/results', summary: 'Aggregated poll / election results', permissions: [P.POLL_MANAGE], params: idParam, response: s.pollResults, handler: async (req: Request, res: Response) => ok(res, await pollExtra.results(sid(req), req.valid.params.id)) })
  .add({ method: 'get', path: '/community-posts', summary: 'Community posts in every status (moderation view)', description: 'Approve/reject via /api/v1/admin/approvals.', permissions: [P.APPROVAL_REVIEW], query: s.postQuery, response: s.postItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await postService.adminList(sid(req), req.valid.query)) });

export const communityResidentRouter = new ModuleRouter('/api/v1/user', {
  tag: 'Resident - Community',
  roles: [UserType.RESIDENT],
  societyScoped: true,
  feature: 'community',
});
communityResidentRouter
  .add({ method: 'get', path: '/notices', summary: 'Society announcements, circulars and events for my flats', query: s.residentNoticeQuery, response: s.noticeItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await noticeExtra.listForResident(sid(req), req.auth.flatIds, req.valid.query)) })
  .add({ method: 'get', path: '/notices/:id', summary: 'Get notice', params: idParam, response: s.noticeItem, handler: async (req: Request, res: Response) => ok(res, await noticeExtra.getForResident(sid(req), req.auth.flatIds, req.valid.params.id)) })
  .add({ method: 'get', path: '/directory', summary: 'Resident directory (name and flat only)', description: 'Phone numbers and other personal data are not exposed; use in-app chat.', query: s.directoryQuery, response: s.directoryItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await directory(sid(req), req.valid.query)) })
  .add({ method: 'post', path: '/community/posts', summary: 'Create a community post draft', body: s.postBody, response: s.postItem, status: 201, handler: async (req: Request, res: Response) => created(res, await postService.create(sid(req), req.auth.userId, req.auth.flatIds, req.valid.body), 'Draft created') })
  .add({ method: 'get', path: '/community/posts', summary: 'Community feed (approved posts only)', query: listQuery, response: s.postItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await postService.feed(sid(req), req.valid.query)) })
  .add({ method: 'get', path: '/community/posts/mine', summary: 'My posts in every status', query: s.postQuery, response: s.postItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await postService.mine(sid(req), req.auth.userId, req.valid.query)) })
  .add({ method: 'patch', path: '/community/posts/:id', summary: 'Edit my draft post', params: idParam, body: s.postBody.partial(), response: s.postItem, errors: [409], handler: async (req: Request, res: Response) => ok(res, await postService.update(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Updated') })
  .add({ method: 'post', path: '/community/posts/:id/submit', summary: 'Submit post for approval', params: idParam, response: s.postItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await postService.submit(sid(req), req.auth.userId, req.valid.params.id), 'Submitted') })
  .add({ method: 'post', path: '/community/posts/:id/withdraw', summary: 'Withdraw post to draft', params: idParam, response: s.postItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await postService.withdraw(sid(req), req.auth.userId, req.valid.params.id), 'Withdrawn') })
  .add({ method: 'get', path: '/community/posts/:id/comments', summary: 'Comments on a post', params: idParam, query: listQuery, response: s.commentItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await postService.comments(sid(req), req.valid.params.id, req.valid.query)) })
  .add({ method: 'post', path: '/community/posts/:id/comments', summary: 'Comment on a post', params: idParam, body: s.commentBody, response: s.commentItem, status: 201, handler: async (req: Request, res: Response) => created(res, await postService.comment(sid(req), req.auth.userId, req.valid.params.id, req.valid.body.text), 'Comment added') })
  .add({ method: 'put', path: '/community/posts/:id/like', summary: 'Like a post', params: idParam, response: null, handler: async (req: Request, res: Response) => {
    await postService.like(sid(req), req.auth.userId, req.valid.params.id, true);
    ok(res, null, 'Liked');
  } })
  .add({ method: 'delete', path: '/community/posts/:id/like', summary: 'Remove like', params: idParam, response: null, handler: async (req: Request, res: Response) => {
    await postService.like(sid(req), req.auth.userId, req.valid.params.id, false);
    ok(res, null, 'Like removed');
  } });

export const pollResidentRouter = new ModuleRouter('/api/v1/user/polls', { tag: 'Resident - Community', roles: [UserType.RESIDENT], societyScoped: true, feature: 'polls' });
pollResidentRouter
  .add({ method: 'get', path: '/', summary: 'Polls, surveys and elections open to me', query: s.pollQuery, response: s.pollItem, paginated: true, handler: async (req: Request, res: Response) => {
    const r = await pollExtra.listForResident(sid(req), req.auth.flatIds, req.valid.query);
    paged(res, { ...r, items: r.items.map(shapePoll) });
  } })
  .add({ method: 'get', path: '/:id', summary: 'Get poll', params: idParam, response: s.pollItem.extend({ hasVoted: z.boolean() }), handler: async (req: Request, res: Response) => {
    const p = await pollExtra.getForResident(sid(req), req.auth.flatIds, req.valid.params.id);
    ok(res, { ...shapePoll(p), hasVoted: await pollExtra.hasVoted(sid(req), req.auth.userId, req.valid.params.id) });
  } })
  .add({ method: 'post', path: '/:id/vote', summary: 'Vote in a poll, survey or election', description: 'One vote per resident (or per flat for elections with onePerFlat). Anonymous polls never expose voter identity.', params: idParam, body: s.voteBody, response: null, status: 201, errors: [409], handler: async (req: Request, res: Response) => {
    await pollExtra.vote(sid(req), req.auth.userId, req.auth.residents, req.valid.params.id, req.valid.body);
    created(res, null, 'Vote recorded');
  } })
  .add({ method: 'get', path: '/:id/results', summary: 'Results (when the poll is closed or showResults is enabled)', params: idParam, response: s.pollResults, errors: [403], handler: async (req: Request, res: Response) => {
    const p = await pollExtra.getForResident(sid(req), req.auth.flatIds, req.valid.params.id);
    if (p.status !== 'CLOSED' && !p.showResults) {
      res.status(403).json({ success: false, error: { code: 'RESULTS_HIDDEN', message: 'Results are not available yet' }, requestId: req.requestId });
      return;
    }
    ok(res, await pollExtra.results(sid(req), req.valid.params.id));
  } });
