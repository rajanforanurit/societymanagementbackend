import { NotificationType } from '../../common/constants/enums';
import { uniqueIds } from '../../common/utils/objectId';
import { logger } from '../../common/utils/logger';
import { realtime } from '../../realtime/socket';
import { User } from '../auth/auth.model';
import { Resident } from '../resident/resident.model';
import { adminUserIdsWith } from '../roles/roles.service';
import { Notification } from './notification.model';

const PREF_KEY: Partial<Record<NotificationType, string>> = {
  VISITOR: 'visitor',
  DELIVERY: 'delivery',
  PAYMENT: 'payment',
  COMPLAINT: 'complaint',
  MARKETPLACE: 'marketplace',
  ANNOUNCEMENT: 'announcement',
  BOOKING: 'booking',
  CHAT: 'chat',
};

export interface NotifyInput {
  societyId?: string;
  userIds: unknown[];
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  event?: string;
}

export async function notifyUsers(p: NotifyInput) {
  try {
    const ids = uniqueIds(p.userIds);
    if (!ids.length) return [];
    const users: any[] = await User.find({ _id: { $in: ids }, isActive: true }).select('notificationPrefs');
    const prefKey = PREF_KEY[p.type];
    const targets = users.filter((u) => p.type === 'EMERGENCY' || !prefKey || u.notificationPrefs?.[prefKey] !== false);
    if (!targets.length) return [];
    const docs: any[] = await Notification.insertMany(
      targets.map((u) => ({ userId: u._id, societyId: p.societyId, type: p.type, title: p.title, body: p.body, data: p.data })),
    );
    docs.forEach((d) => {
      realtime.toUser(String(d.userId), 'notification:new', d.toJSON());
      if (p.event) realtime.toUser(String(d.userId), p.event, { title: p.title, body: p.body, ...p.data });
    });
    return docs;
  } catch (err) {
    logger.error('notify_failed', { error: (err as Error).message });
    return [];
  }
}

export async function residentUserIdsOfFlat(societyId: string, flatId: string, flag?: string) {
  const residents: any[] = await Resident.find({ societyId, flatId, status: 'APPROVED' }).select('userId permissions');
  return residents.filter((r) => !flag || r.permissions?.[flag] !== false).map((r) => String(r.userId));
}

export async function notifyFlat(societyId: string, flatId: string, p: Omit<NotifyInput, 'userIds' | 'societyId'>, flag?: string) {
  const userIds = await residentUserIdsOfFlat(societyId, flatId, flag);
  const docs = await notifyUsers({ ...p, societyId, userIds });
  realtime.toFlat(flatId, p.event ?? 'notification:flat', { title: p.title, body: p.body, ...p.data });
  return docs;
}

export async function notifyAdmins(societyId: string, permission: string | undefined, p: Omit<NotifyInput, 'userIds' | 'societyId'>) {
  const userIds = await adminUserIdsWith(societyId, permission);
  await notifyUsers({ ...p, societyId, userIds });
  realtime.toAdmins(societyId, p.event ?? 'notification:admin', { title: p.title, body: p.body, ...p.data });
}

export async function notifyAllResidents(societyId: string, p: Omit<NotifyInput, 'userIds' | 'societyId'>, flatIds?: string[]) {
  const filter: Record<string, unknown> = { societyId, status: 'APPROVED' };
  if (flatIds?.length) filter.flatId = { $in: flatIds };
  const residents: any[] = await Resident.find(filter).select('userId');
  await notifyUsers({ ...p, societyId, userIds: residents.map((r) => r.userId) });
  realtime.toSociety(societyId, p.event ?? 'notification:society', { title: p.title, body: p.body, ...p.data });
}
