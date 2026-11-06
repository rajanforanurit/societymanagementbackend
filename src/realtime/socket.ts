import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { UserType } from '../common/constants/enums';
import { logger } from '../common/utils/logger';
import { env } from '../config/env';
import { buildAuthContext } from '../middleware/auth.middleware';

let io: Server | undefined;

export const initSocket = (server: HttpServer) => {
  io = new Server(server, { cors: { origin: env.corsOrigins, credentials: true }, path: '/socket.io' });

  io.use(async (socket, next) => {
    try {
      const raw = socket.handshake.auth?.token ?? socket.handshake.headers.authorization;
      if (!raw) return next(new Error('AUTH_REQUIRED'));
      const token = String(raw).replace(/^Bearer\s+/i, '');
      socket.data.auth = await buildAuthContext(token);
      next();
    } catch {
      next(new Error('AUTH_INVALID'));
    }
  });

  io.on('connection', (socket) => {
    const a = socket.data.auth;
    socket.join(`user:${a.userId}`);
    if (a.societyId) {
      socket.join(`society:${a.societyId}`);
      if (a.role === UserType.SOCIETY_ADMIN) socket.join(`society:${a.societyId}:admins`);
      if (a.role === UserType.GUARD) {
        socket.join(`society:${a.societyId}:guards`);
        if (a.gateId) socket.join(`gate:${a.gateId}`);
      }
      if (a.role === UserType.RESIDENT) a.flatIds.forEach((f: string) => socket.join(`flat:${f}`));
    }
    socket.emit('ready', { userId: a.userId, role: a.role, societyId: a.societyId ?? null });
    socket.on('chat:typing', (p: { conversationId?: string; toUserId?: string }) => {
      if (p?.toUserId && /^[a-f\d]{24}$/i.test(p.toUserId)) {
        io?.to(`user:${p.toUserId}`).emit('chat:typing', { conversationId: p.conversationId, fromUserId: a.userId });
      }
    });
    logger.debug('socket_connected', { userId: a.userId });
  });
  return io;
};

const emit = (room: string, event: string, payload: unknown) => {
  io?.to(room).emit(event, payload);
};

export const realtime = {
  toUser: (userId: string, event: string, payload: unknown) => emit(`user:${userId}`, event, payload),
  toSociety: (societyId: string, event: string, payload: unknown) => emit(`society:${societyId}`, event, payload),
  toAdmins: (societyId: string, event: string, payload: unknown) => emit(`society:${societyId}:admins`, event, payload),
  toGuards: (societyId: string, event: string, payload: unknown) => emit(`society:${societyId}:guards`, event, payload),
  toGate: (gateId: string, event: string, payload: unknown) => emit(`gate:${gateId}`, event, payload),
  toFlat: (flatId: string, event: string, payload: unknown) => emit(`flat:${flatId}`, event, payload),
  connectedCount: () => io?.engine.clientsCount ?? 0,
};
