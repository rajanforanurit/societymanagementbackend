import { ConversationContext, vals } from '../../common/constants/enums';
import { Schema } from 'mongoose';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const Conversation = defineModel(
  'Conversation',
  makeSchema(
    {
      participants: [{ type: Schema.Types.ObjectId, ref: 'User', required: true }],
      participantsKey: { type: String, required: true },
      contextType: { type: String, enum: vals(ConversationContext), default: 'DIRECT' },
      contextId: { type: Schema.Types.ObjectId },
      contextTitle: String,
      lastMessage: { text: String, senderId: ref('User'), at: Date },
      unread: { type: Map, of: Number, default: {} },
    },
    { indexes: [[{ societyId: 1, participantsKey: 1, contextType: 1, contextId: 1 }, { unique: true }], [{ societyId: 1, participants: 1, updatedAt: -1 }]] },
  ),
);

export const Message = defineModel(
  'Message',
  makeSchema(
    { conversationId: refReq('Conversation', { index: true }), senderId: refReq('User'), text: { type: String, required: true, maxlength: 2000 }, attachments: [ref('File')], readBy: [ref('User')] },
    { indexes: [[{ societyId: 1, conversationId: 1, createdAt: -1 }]] },
  ),
);
