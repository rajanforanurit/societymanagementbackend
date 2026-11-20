import { createHmac } from 'crypto';
import { NotificationType, ProfileStatus, ResidentStatus, UserType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { escapeRegex, applyListFilters, paginate } from '../../common/utils/pagination';
import { env } from '../../config/env';
import { realtime, registerCallSignalHandler } from '../../realtime/socket';
import { AdminProfile } from '../admin/admin.model';
import { User } from '../auth/auth.model';
import { Guard } from '../guard/guard.model';
import { notifyUsers } from '../notifications/notify.service';
import { Resident } from '../resident/resident.model';
import { Flat, Gate } from '../society/society.model';
import { Call } from './call.model';

type Role = 'RESIDENT' | 'GUARD' | 'SOCIETY_ADMIN';
export interface Caller {
  societyId: string;
  userId: string;
  role: Role;
  flatIds: string[];
  gateId?: string;
}

/** Who may call whom (all inside one society). */
const ALLOWED: Record<Role, Role[]> = {
  RESIDENT: ['GUARD', 'SOCIETY_ADMIN'],
  GUARD: ['SOCIETY_ADMIN', 'RESIDENT'],
  SOCIETY_ADMIN: ['RESIDENT', 'GUARD'],
};
const MAX_CALL_MS = 2 * 3600 * 1000;
const ringMs = () => env.CALL_RING_SECONDS * 1000;
const ids = (c: any) => [String(c.callerId), String(c.calleeId)];

/** STUN + (optional) TURN with coturn-style time-limited credentials. */
export function iceServers(userId: string) {
  const split = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);
  const servers: { urls: string[]; username?: string; credential?: string }[] = [];
  const stun = split(env.STUN_URLS);
  if (stun.length) servers.push({ urls: stun });
  const turn = split(env.TURN_URLS);
  if (turn.length && env.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + env.TURN_TTL_SECONDS}:${userId}`;
    servers.push({ urls: turn, username, credential: createHmac('sha1', env.TURN_SECRET).update(username).digest('base64') });
  }
  return { iceServers: servers, ringSeconds: env.CALL_RING_SECONDS, expiresInSeconds: env.TURN_TTL_SECONDS };
}

/** Is `userId` an active member of the society with this role? Returns a display label, or null. */
async function membership(societyId: string, userId: string, role: Role): Promise<{ label?: string } | null> {
  if (role === 'GUARD') {
    const g: any = await Guard.findOne({ societyId, userId, status: ProfileStatus.ACTIVE });
    if (!g) return null;
    const gate: any = await Gate.findOne({ _id: g.gateId, societyId }).select('name');
    return { label: gate?.name };
  }
  if (role === 'SOCIETY_ADMIN') {
    const a: any = await AdminProfile.findOne({ societyId, userId, status: ProfileStatus.ACTIVE });
    return a ? { label: a.designation ?? 'Society admin' } : null;
  }
  const r: any = await Resident.findOne({ societyId, userId, status: ResidentStatus.APPROVED });
  if (!r) return null;
  const f: any = await Flat.findOne({ _id: r.flatId, societyId }).select('label');
  return { label: f?.label };
}

export const callService = {
  /** Directory of people this user may call. Residents and guards only ever see name + flat/gate/designation, never phone numbers. */
  async contacts(c: Caller, q: { role?: Role; search?: string; limit: number }) {
    const want = ALLOWED[c.role].filter((r) => !q.role || r === q.role);
    const out: { userId: string; name: string; role: Role; label?: string }[] = [];
    const rx = q.search ? new RegExp(escapeRegex(q.search), 'i') : undefined;
    const name = async (uids: unknown[]) => new Map((await User.find({ _id: { $in: uids }, isActive: true, ...(rx ? { name: rx } : {}) }).select('name')).map((u: any) => [String(u._id), u.name as string]));

    if (want.includes('SOCIETY_ADMIN')) {
      const rows: any[] = await AdminProfile.find({ societyId: c.societyId, status: ProfileStatus.ACTIVE }).limit(100);
      const names = await name(rows.map((r) => r.userId));
      rows.forEach((r) => names.has(String(r.userId)) && String(r.userId) !== c.userId && out.push({ userId: String(r.userId), name: names.get(String(r.userId))!, role: 'SOCIETY_ADMIN', label: r.designation ?? 'Society admin' }));
    }
    if (want.includes('GUARD')) {
      const rows: any[] = await Guard.find({ societyId: c.societyId, status: ProfileStatus.ACTIVE }).limit(100);
      const names = await name(rows.map((r) => r.userId));
      const gates: any[] = await Gate.find({ societyId: c.societyId, _id: { $in: rows.map((r) => r.gateId) } }).select('name');
      const gateName = new Map(gates.map((g) => [String(g._id), g.name]));
      rows.forEach((r) => names.has(String(r.userId)) && out.push({ userId: String(r.userId), name: names.get(String(r.userId))!, role: 'GUARD', label: gateName.get(String(r.gateId)) }));
    }
    if (want.includes('RESIDENT')) {
      const rows: any[] = await Resident.find({ societyId: c.societyId, status: ResidentStatus.APPROVED, residentType: { $ne: 'FAMILY_MEMBER' } }).limit(500);
      const names = await name(rows.map((r) => r.userId));
      const flats: any[] = await Flat.find({ societyId: c.societyId, _id: { $in: rows.map((r) => r.flatId) } }).select('label');
      const label = new Map(flats.map((f) => [String(f._id), f.label]));
      const seen = new Set<string>();
      rows.forEach((r) => {
        const uid = String(r.userId);
        if (!names.has(uid) || uid === c.userId || seen.has(uid)) return;
        seen.add(uid);
        out.push({ userId: uid, name: names.get(uid)!, role: 'RESIDENT', label: label.get(String(r.flatId)) });
      });
    }
    return out.sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name)).slice(0, q.limit);
  },

  async start(c: Caller, calleeId: string) {
    if (calleeId === c.userId) throw ApiError.badRequest('You cannot call yourself', 'CALL_SELF');
    const callee: any = await User.findById(calleeId).select('name userType isActive');
    // Same answer for "no such user" and "other society": never reveal who exists elsewhere.
    if (!callee || !callee.isActive || !ALLOWED[c.role].includes(callee.userType)) throw ApiError.forbidden('You cannot call this person', 'CALL_NOT_ALLOWED');
    const calleeMember = await membership(c.societyId, calleeId, callee.userType);
    if (!calleeMember) throw ApiError.forbidden('You cannot call this person', 'CALL_NOT_ALLOWED');
    const callerMember = await membership(c.societyId, c.userId, c.role);
    const me: any = await User.findById(c.userId).select('name');

    const now = Date.now();
    const busy = await Call.exists({
      societyId: c.societyId,
      $and: [
        { $or: [{ callerId: { $in: [c.userId, calleeId] } }, { calleeId: { $in: [c.userId, calleeId] } }] },
        { $or: [{ status: 'RINGING', createdAt: { $gte: new Date(now - ringMs() - 10000) } }, { status: 'ACCEPTED', answeredAt: { $gte: new Date(now - MAX_CALL_MS) } }] },
      ],
    });
    if (busy) throw ApiError.conflict('You or the other person is already on a call', 'CALL_BUSY');

    const call: any = await Call.create({ societyId: c.societyId, callerId: c.userId, calleeId, callerRole: c.role, calleeRole: callee.userType, callerName: me?.name, callerLabel: callerMember?.label, calleeName: callee.name, calleeLabel: calleeMember.label });
    const payload = { callId: String(call._id), callerId: c.userId, callerName: me?.name, callerRole: c.role, callerLabel: callerMember?.label, societyId: c.societyId, ringSeconds: env.CALL_RING_SECONDS };
    realtime.toUser(calleeId, 'call:incoming', payload);
    // Push so a closed / background app can ring (the app turns this into a full-screen call UI).
    await notifyUsers({ societyId: c.societyId, userIds: [calleeId], type: NotificationType.CALL, title: `Incoming call from ${me?.name ?? 'someone'}`, body: callerMember?.label ? `${c.role === 'RESIDENT' ? 'Flat' : c.role === 'GUARD' ? 'Gate' : ''} ${callerMember.label}`.trim() : 'Tap to answer', data: { ...payload, kind: 'incoming_call' } });
    setTimeout(() => void callService.expireOne(String(call._id)), ringMs() + 1000).unref();
    return call;
  },

  async load(c: { societyId: string; userId: string }, id: string) {
    const call: any = await Call.findOne({ _id: id, societyId: c.societyId, $or: [{ callerId: c.userId }, { calleeId: c.userId }] });
    if (!call) throw ApiError.notFound('Call not found');
    return call;
  },

  async transition(c: { societyId: string; userId: string }, id: string, to: 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'ENDED'): Promise<any> {
    const call = await callService.load(c, id);
    const isCaller = String(call.callerId) === c.userId;
    const from = call.status;
    if (to === 'ACCEPTED' || to === 'REJECTED') {
      if (isCaller) throw ApiError.forbidden('Only the person being called can do this', 'CALL_FORBIDDEN');
      if (from !== 'RINGING') throw ApiError.conflict('This call is no longer ringing', 'CALL_NOT_RINGING');
    }
    if (to === 'CANCELLED' && (!isCaller || from !== 'RINGING')) throw ApiError.conflict('Only the caller can cancel a ringing call', 'CALL_NOT_RINGING');
    if (to === 'ENDED' && from !== 'ACCEPTED') {
      // "End" on a ringing call means cancel (caller) or reject (callee).
      if (from === 'RINGING') return callService.transition(c, id, isCaller ? 'CANCELLED' : 'REJECTED');
      return call; // already finished: ending twice is harmless
    }
    const set: Record<string, unknown> = { status: to };
    if (to === 'ACCEPTED') set.answeredAt = new Date();
    else Object.assign(set, { endedAt: new Date(), endedBy: c.userId, endReason: to.toLowerCase() });
    const updated: any = await Call.findOneAndUpdate({ _id: id, societyId: c.societyId, status: from }, { $set: set }, { new: true });
    if (!updated) return callService.load(c, id); // lost a race; return current state
    const evt = { ACCEPTED: 'call:accepted', REJECTED: 'call:rejected', CANCELLED: 'call:cancelled', ENDED: 'call:ended' }[to];
    ids(updated).forEach((uid) => realtime.toUser(uid, evt, { callId: id, status: to, byUserId: c.userId }));
    return updated;
  },

  async expireOne(id: string) {
    const call: any = await Call.findOneAndUpdate({ _id: id, status: 'RINGING', createdAt: { $lt: new Date(Date.now() - ringMs()) } }, { $set: { status: 'MISSED', endedAt: new Date(), endReason: 'no_answer' } }, { new: true }).setOptions({ skipTenantCheck: true });
    if (!call) return;
    ids(call).forEach((uid) => realtime.toUser(uid, 'call:missed', { callId: id, status: 'MISSED' }));
    await notifyUsers({ societyId: String(call.societyId), userIds: [call.calleeId], type: NotificationType.CALL, title: 'Missed call', body: `${call.callerName ?? 'Someone'} called you`, data: { callId: id, kind: 'missed_call' } });
  },

  /** Safety net for ring timers lost on a restart, and calls whose app crashed before ending them. */
  async sweep() {
    const ringing: any[] = await Call.find({ status: 'RINGING', createdAt: { $lt: new Date(Date.now() - ringMs()) } }).setOptions({ skipTenantCheck: true }).select('_id').limit(200);
    for (const r of ringing) await callService.expireOne(String(r._id));
    await Call.updateMany({ status: 'ACCEPTED', answeredAt: { $lt: new Date(Date.now() - MAX_CALL_MS) } }, { $set: { status: 'ENDED', endedAt: new Date(), endReason: 'timeout' } }).setOptions({ skipTenantCheck: true });
  },

  async history(c: { societyId: string; userId: string }, q: any) {
    const f: Record<string, unknown> = { societyId: c.societyId, $or: [{ callerId: c.userId }, { calleeId: c.userId }] };
    if (q.status) f.status = q.status;
    return paginate(Call, applyListFilters(f, q), q, { sortable: ['createdAt'] });
  },

  /** Relay a WebRTC offer / answer / ICE candidate to the other participant of an active call. */
  async relaySignal(c: { societyId: string; userId: string }, input: { callId: string; type: string; data: unknown }) {
    const call: any = await Call.findOne({ _id: input.callId, societyId: c.societyId, status: { $in: ['RINGING', 'ACCEPTED'] }, $or: [{ callerId: c.userId }, { calleeId: c.userId }] }).select('callerId calleeId');
    if (!call) return false;
    if (JSON.stringify(input.data ?? null).length > 16000) return false;
    const other = String(call.callerId) === c.userId ? String(call.calleeId) : String(call.callerId);
    realtime.toUser(other, 'call:signal', { callId: input.callId, type: input.type, data: input.data, fromUserId: c.userId });
    return true;
  },
};


registerCallSignalHandler((c, i) => callService.relaySignal(c, i));
