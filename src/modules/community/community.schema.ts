import { z } from 'zod';
import { ApprovalStatus, NoticeType, PollKind, PollStatus, PublishStatus, QuestionType, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateTime, listQuery, objectId } from '../../common/validators/common';

const audience = z.object({ all: z.boolean().default(true), towerIds: z.array(objectId).max(100).default([]), flatIds: z.array(objectId).max(500).default([]) });
export const noticeBody = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(3).max(10000),
  type: z.enum(vals(NoticeType)).default('ANNOUNCEMENT'),
  audience: audience.default({ all: true, towerIds: [], flatIds: [] }),
  pinned: z.boolean().default(false),
  attachments: z.array(objectId).max(5).default([]),
  publishAt: dateTime.optional(),
  expiresAt: dateTime.optional(),
  event: z.object({ startsAt: dateTime, endsAt: dateTime.optional(), venue: z.string().max(200).optional() }).optional(),
});
export const noticeItem = entity({ title: z.string(), body: z.string(), type: z.enum(vals(NoticeType)), audience, status: z.enum(vals(PublishStatus)), pinned: z.boolean(), attachments: z.array(objectId), publishAt: dateTime.optional(), expiresAt: dateTime.optional(), event: z.object({ startsAt: dateTime.optional(), endsAt: dateTime.optional(), venue: z.string().optional() }).optional() });
export const noticeQuery = listQuery.extend({ type: z.enum(vals(NoticeType)).optional(), status: z.enum(vals(PublishStatus)).optional() });
export const residentNoticeQuery = listQuery.extend({ type: z.enum(vals(NoticeType)).optional() });

const option = z.object({ label: z.string().trim().min(1).max(120), candidateUserId: objectId.optional(), manifesto: z.string().max(1000).optional() });
const question = z.object({ text: z.string().trim().min(3).max(300), type: z.enum(vals(QuestionType)).default('SINGLE_CHOICE'), required: z.boolean().default(true), options: z.array(option).max(20).default([]) });
export const pollBody = z.object({
  kind: z.enum(vals(PollKind)).default('POLL'),
  title: z.string().trim().min(3).max(200),
  description: z.string().max(2000).optional(),
  questions: z.array(question).min(1).max(30),
  anonymous: z.boolean().default(true),
  onePerFlat: z.boolean().default(false),
  showResults: z.boolean().default(false),
  audience: audience.default({ all: true, towerIds: [], flatIds: [] }),
  startsAt: dateTime.optional(),
  endsAt: dateTime.optional(),
});
export const pollItem = entity({ kind: z.enum(vals(PollKind)), title: z.string(), description: z.string().optional(), questions: z.array(z.object({ id: objectId, text: z.string(), type: z.enum(vals(QuestionType)), required: z.boolean(), options: z.array(z.object({ id: objectId, label: z.string(), manifesto: z.string().optional() })) })), anonymous: z.boolean(), onePerFlat: z.boolean(), showResults: z.boolean(), status: z.enum(vals(PollStatus)), startsAt: dateTime.optional(), endsAt: dateTime.optional() });
export const pollQuery = listQuery.extend({ kind: z.enum(vals(PollKind)).optional(), status: z.enum(vals(PollStatus)).optional() });
export const voteBody = z.object({ flatId: objectId.optional(), answers: z.array(z.object({ questionId: objectId, optionIds: z.array(objectId).max(20).default([]), text: z.string().max(1000).optional() })).min(1).max(30) });
export const pollResults = z.object({ pollId: objectId, totalVotes: z.number().int(), questions: z.array(z.object({ questionId: objectId, text: z.string(), responses: z.number().int(), options: z.array(z.object({ optionId: objectId, label: z.string(), votes: z.number().int() })), textAnswers: z.array(z.string()).optional() })) });

export const postBody = z.object({ title: z.string().trim().min(3).max(150), body: z.string().trim().min(5).max(5000), images: z.array(objectId).max(5).default([]) });
export const postItem = entity({ authorId: objectId, authorName: z.string().optional(), flatLabel: z.string().optional(), title: z.string(), body: z.string(), images: z.array(objectId), status: z.enum(vals(ApprovalStatus)), rejectionReason: z.string().optional(), publishedAt: dateTime.optional(), likeCount: z.number().int(), commentCount: z.number().int() });
export const postQuery = listQuery.extend({ status: z.enum(vals(ApprovalStatus)).optional() });
export const commentBody = z.object({ text: z.string().trim().min(1).max(1000) });
export const commentItem = entity({ postId: objectId, userId: objectId, userName: z.string().optional(), text: z.string() });
export const directoryItem = z.object({ userId: objectId, name: z.string(), flatLabel: z.string().optional(), residentType: z.string() });
export const directoryQuery = listQuery;
