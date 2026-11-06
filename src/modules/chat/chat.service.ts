import { NotificationType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { paginate } from '../../common/utils/pagination';
import { realtime } from '../../realtime/socket';
import { Resident } from '../resident/resident.model';
import { MarketplaceListing } from '../marketplace/marketplace.model';
import { PropertyListing } from '../property/property.model';
import { notifyUsers } from '../notifications/notify.service';
import { Conversation, Message } from './chat.model';

const key = (a: string, b: string) => [a, b].sort().join(':');

export const chatService = {
  async start(societyId: string, userId: string, body: any) {
    if (body.recipientUserId === userId) throw ApiError.badRequest('You cannot message yourself');
    if (!(await Resident.exists({ societyId, userId: body.recipientUserId, status: 'APPROVED' }))) throw ApiError.notFound('Recipient not found in this society');
    let contextTitle: string | undefined;
    if (body.contextType !== 'DIRECT') {
      const model = body.contextType === 'MARKETPLACE_LISTING' ? MarketplaceListing : PropertyListing;
      const l: any = await model.findOne({ _id: body.contextId, societyId });
      if (!l) throw ApiError.notFound('Listing not found');
      contextTitle = l.title;
    }
    const conv: any = await Conversation.findOneAndUpdate(
      { societyId, participantsKey: key(userId, body.recipientUserId), contextType: body.contextType, contextId: body.contextId ?? null },
      { $setOnInsert: { participants: [userId, body.recipientUserId], contextTitle, createdBy: userId } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    if (body.message) await chatService.send(societyId, userId, String(conv._id), { text: body.message, attachments: [] });
    return conv;
  },
  async list(societyId: string, userId: string, q: any) {
    const r = await paginate(Conversation, { societyId, participants: userId }, q, { sortable: ['updatedAt', 'createdAt'], defaultSort: '-updatedAt' });
    return { ...r, items: r.items.map((c: any) => ({ ...c.toJSON(), unreadCount: c.unread?.get?.(userId) ?? 0 })) };
  },
  async mine(societyId: string, userId: string, id: string) {
    const c: any = await Conversation.findOne({ _id: id, societyId, participants: userId });
    if (!c) throw ApiError.notFound('Conversation not found');
    return c;
  },
  async messages(societyId: string, userId: string, id: string, q: any) {
    await chatService.mine(societyId, userId, id);
    return paginate(Message, { societyId, conversationId: id }, q, { sortable: ['createdAt'], defaultSort: '-createdAt' });
  },
  async send(societyId: string, userId: string, id: string, body: { text: string; attachments: string[] }) {
    const c = await chatService.mine(societyId, userId, id);
    const other = c.participants.map(String).find((p: string) => p !== userId);
    const [msg]: any[] = await Message.create([{ societyId, conversationId: id, senderId: userId, text: body.text, attachments: body.attachments, readBy: [userId], createdBy: userId }]);
    await Conversation.updateOne({ _id: id, societyId }, { $set: { lastMessage: { text: body.text.slice(0, 200), senderId: userId, at: new Date() } }, $inc: { [`unread.${other}`]: 1 } });
    realtime.toUser(other, 'chat:message', msg.toJSON());
    realtime.toUser(userId, 'chat:message', msg.toJSON());
    await notifyUsers({ societyId, userIds: [other], type: NotificationType.CHAT, title: 'New message', body: body.text.slice(0, 100), data: { conversationId: id } });
    return msg;
  },
  async markRead(societyId: string, userId: string, id: string) {
    await chatService.mine(societyId, userId, id);
    await Message.updateMany({ societyId, conversationId: id, readBy: { $ne: userId } }, { $addToSet: { readBy: userId } });
    await Conversation.updateOne({ _id: id, societyId }, { $set: { [`unread.${userId}`]: 0 } });
  },
};
