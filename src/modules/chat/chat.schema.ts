import { z } from 'zod';
import { ConversationContext, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateTime, listQuery, objectId } from '../../common/validators/common';

export const startBody = z.object({ recipientUserId: objectId, contextType: z.enum(vals(ConversationContext)).default('DIRECT'), contextId: objectId.optional(), message: z.string().trim().min(1).max(2000).optional() });
export const conversationItem = entity({ participants: z.array(objectId), contextType: z.enum(vals(ConversationContext)), contextId: objectId.optional(), contextTitle: z.string().optional(), lastMessage: z.object({ text: z.string().optional(), senderId: objectId.optional(), at: dateTime.optional() }).optional(), unreadCount: z.number().int().optional() });
export const messageBody = z.object({ text: z.string().trim().min(1).max(2000), attachments: z.array(objectId).max(3).default([]) });
export const messageItem = entity({ conversationId: objectId, senderId: objectId, text: z.string(), attachments: z.array(objectId), readBy: z.array(objectId) });
export const chatQuery = listQuery;
