import { Request, Response } from 'express';
import { z } from 'zod';
import { UserType } from '../../common/constants/enums';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { ApiError } from '../../common/utils/apiError';
import { idParam } from '../../common/validators/common';
import * as s from './call.schema';
import { callService as svc, Caller, iceServers } from './call.service';

export const callRouter = new ModuleRouter('/api/v1/calls', {
  tag: 'In-app Calls',
  tagDescription: 'App-to-app audio calls between residents, guards and society admins of the same society. REST starts/answers/ends calls and Socket.IO relays WebRTC signaling (emit call:signal {callId,type:offer|answer|candidate,data}); events call:incoming, call:accepted, call:rejected, call:cancelled, call:ended, call:missed, call:signal. Audio is peer-to-peer WebRTC (STUN/TURN from /calls/ice-servers), not Socket.IO.',
  roles: [UserType.RESIDENT, UserType.GUARD, UserType.SOCIETY_ADMIN],
  societyScoped: true,
});

const me = (req: Request): Caller => {
  if (req.auth.impersonationId) throw ApiError.forbidden('Calls are not available while impersonating', 'CALL_NOT_ALLOWED');
  return { societyId: req.auth.societyId!, userId: req.auth.userId, role: req.auth.role as Caller['role'], flatIds: req.auth.flatIds, gateId: req.auth.gateId };
};
const act = (to: 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'ENDED') => async (req: Request, res: Response) => ok(res, await svc.transition(me(req), req.valid.params.id, to));

callRouter
  .add({ method: 'get', path: '/ice-servers', summary: 'STUN/TURN servers for WebRTC (time-limited credentials)', response: s.iceItem, handler: async (req: Request, res: Response) => ok(res, iceServers(req.auth.userId)) })
  .add({ method: 'get', path: '/contacts', summary: 'People I can call, according to my role and society', query: s.contactsQuery, response: z.array(s.contactItem), handler: async (req: Request, res: Response) => ok(res, await svc.contacts(me(req), req.valid.query)) })
  .add({ method: 'get', path: '/history', summary: 'My call history', query: s.historyQuery, response: s.callItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await svc.history(me(req), req.valid.query)) })
  .add({ method: 'post', path: '/', summary: 'Start a call', description: 'Rings the callee (socket call:incoming + push). 403 if the callee is outside my society or not allowed for my role; 409 if either side is busy.', body: s.startCallBody, response: s.callItem, status: 201, errors: [403, 409], handler: async (req: Request, res: Response) => created(res, await svc.start(me(req), req.valid.body.calleeId), 'Calling') })
  .add({ method: 'get', path: '/:id', summary: 'Call status', params: idParam, response: s.callItem, handler: async (req: Request, res: Response) => ok(res, await svc.load(me(req), req.valid.params.id)) })
  .add({ method: 'post', path: '/:id/accept', summary: 'Accept an incoming call', params: idParam, response: s.callItem, status: 200, errors: [409], handler: act('ACCEPTED') })
  .add({ method: 'post', path: '/:id/reject', summary: 'Reject an incoming call', params: idParam, response: s.callItem, status: 200, errors: [409], handler: act('REJECTED') })
  .add({ method: 'post', path: '/:id/cancel', summary: 'Cancel my outgoing call while it rings', params: idParam, response: s.callItem, status: 200, errors: [409], handler: act('CANCELLED') })
  .add({ method: 'post', path: '/:id/end', summary: 'End a call', description: 'Ends an accepted call; on a ringing call it cancels (caller) or rejects (callee). Idempotent.', params: idParam, response: s.callItem, status: 200, handler: act('ENDED') });
