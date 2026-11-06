import { Request, Response } from 'express';
import { UserType } from '../../common/constants/enums';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { idParam } from '../../common/validators/common';
import * as s from './chat.schema';
import { chatService as c } from './chat.service';

export const chatRouter = new ModuleRouter('/api/v1/user/chat', {
  tag: 'Resident - Community',
  tagDescription: 'Announcements, posts, polls, elections, in-app chat and the resident directory',
  roles: [UserType.RESIDENT],
  societyScoped: true,
  feature: 'chat',
});
const sid = (r: Request) => r.auth.societyId!;
chatRouter
  .add({ method: 'post', path: '/conversations', summary: 'Start (or reopen) a conversation with a neighbour', description: 'Optionally tied to a marketplace or property listing. Messages are pushed over Socket.IO (chat:message).', body: s.startBody, response: s.conversationItem, status: 201, handler: async (req: Request, res: Response) => created(res, await c.start(sid(req), req.auth.userId, req.valid.body), 'Conversation ready') })
  .add({ method: 'get', path: '/conversations', summary: 'My conversations', query: s.chatQuery, response: s.conversationItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await c.list(sid(req), req.auth.userId, req.valid.query)) })
  .add({ method: 'get', path: '/conversations/:id/messages', summary: 'Messages in a conversation', params: idParam, query: s.chatQuery, response: s.messageItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await c.messages(sid(req), req.auth.userId, req.valid.params.id, req.valid.query)) })
  .add({ method: 'post', path: '/conversations/:id/messages', summary: 'Send a message', params: idParam, body: s.messageBody, response: s.messageItem, status: 201, handler: async (req: Request, res: Response) => created(res, await c.send(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Sent') })
  .add({ method: 'post', path: '/conversations/:id/read', summary: 'Mark conversation as read', params: idParam, response: null, status: 200, handler: async (req: Request, res: Response) => {
    await c.markRead(sid(req), req.auth.userId, req.valid.params.id);
    ok(res, null, 'Marked as read');
  } });
