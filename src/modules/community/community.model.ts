import { Schema } from 'mongoose';
import { ApprovalStatus, NoticeType, PollKind, PollStatus, PublishStatus, QuestionType, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

const audience = { all: { type: Boolean, default: true }, towerIds: [ref('Tower')], flatIds: [ref('Flat')] };

export const Notice = defineModel(
  'Notice',
  makeSchema(
    {
      title: { type: String, required: true, trim: true },
      body: { type: String, required: true },
      type: { type: String, enum: vals(NoticeType), default: 'ANNOUNCEMENT', index: true },
      audience,
      status: { type: String, enum: vals(PublishStatus), default: 'DRAFT', index: true },
      pinned: { type: Boolean, default: false },
      attachments: [ref('File')],
      publishAt: Date,
      expiresAt: Date,
      event: { startsAt: Date, endsAt: Date, venue: String },
      authorId: ref('User'),
    },
    { indexes: [[{ societyId: 1, status: 1, publishAt: -1 }]] },
  ),
);

export const Poll = defineModel(
  'Poll',
  makeSchema(
    {
      kind: { type: String, enum: vals(PollKind), default: 'POLL' },
      title: { type: String, required: true },
      description: String,
      questions: [{ text: { type: String, required: true }, type: { type: String, enum: vals(QuestionType), default: 'SINGLE_CHOICE' }, required: { type: Boolean, default: true }, options: [{ label: { type: String, required: true }, candidateUserId: ref('User'), manifesto: String }] }],
      anonymous: { type: Boolean, default: true },
      onePerFlat: { type: Boolean, default: false },
      showResults: { type: Boolean, default: false },
      audience,
      startsAt: Date,
      endsAt: Date,
      status: { type: String, enum: vals(PollStatus), default: 'DRAFT', index: true },
    },
    { indexes: [[{ societyId: 1, status: 1, endsAt: 1 }]] },
  ),
);

export const Vote = defineModel(
  'Vote',
  makeSchema(
    { pollId: refReq('Poll', { index: true }), voteKey: { type: String, required: true }, userId: refReq('User'), flatId: ref('Flat'), answers: [{ questionId: { type: Schema.Types.ObjectId, required: true }, optionIds: [{ type: Schema.Types.ObjectId }], text: String }] },
    { audited: false, indexes: [[{ societyId: 1, pollId: 1, voteKey: 1 }, { unique: true }]] },
  ),
);

export const CommunityPost = defineModel(
  'CommunityPost',
  makeSchema(
    {
      authorId: refReq('User', { index: true }),
      authorName: String,
      flatLabel: String,
      title: { type: String, required: true },
      body: { type: String, required: true, maxlength: 5000 },
      images: [ref('File')],
      status: { type: String, enum: vals(ApprovalStatus), default: 'DRAFT', index: true },
      rejectionReason: String,
      publishedAt: Date,
      likeCount: { type: Number, default: 0 },
      commentCount: { type: Number, default: 0 },
    },
    { indexes: [[{ societyId: 1, status: 1, publishedAt: -1 }]] },
  ),
);

export const PostComment = defineModel('PostComment', makeSchema({ postId: refReq('CommunityPost', { index: true }), userId: refReq('User'), userName: String, text: { type: String, required: true, maxlength: 1000 } }, { audited: false, indexes: [[{ societyId: 1, postId: 1, createdAt: 1 }]] }));
export const PostLike = defineModel('PostLike', makeSchema({ postId: refReq('CommunityPost'), userId: refReq('User') }, { audited: false, indexes: [[{ societyId: 1, postId: 1, userId: 1 }, { unique: true }]] }));
