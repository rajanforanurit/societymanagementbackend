import { realtime } from '../../realtime/socket';
import { ApprovalEntityType, NotificationType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { oid } from '../../common/utils/objectId';
import { createCrudService } from '../../common/services/crud.service';
import { applyTransition, listingAutoPublish, registerWorkflowEntity, VISIBLE_STATUSES } from '../approvals/approval.service';
import { User } from '../auth/auth.model';
import { notifyAdmins, notifyAllResidents, notifyUsers } from '../notifications/notify.service';
import { Resident } from '../resident/resident.model';
import { Flat } from '../society/society.model';
import { ApprovalRequest } from '../approvals/approval.model';
import { File } from '../files/files.model';
import { CommunityPost, Notice, Poll, PostComment, PostLike, PostView, Vote } from './community.model';

export const noticeService = createCrudService({ model: Notice, name: 'Notice', searchFields: ['title', 'body'], filterable: ['type', 'status'], sortable: ['createdAt', 'publishAt', 'pinned'] });
export const pollService = createCrudService({ model: Poll, name: 'Poll', searchFields: ['title'], filterable: ['kind', 'status'], sortable: ['createdAt', 'endsAt'] });

const shapePoll = (p: any) => {
  const j = p.toJSON();
  j.questions = (j.questions ?? []).map((q: any) => ({ ...q, id: q.id ?? q._id, options: (q.options ?? []).map((o: any) => ({ id: o.id ?? o._id, label: o.label, manifesto: o.manifesto })) }));
  return j;
};
export { shapePoll };

const audienceFilter = async (societyId: string, flatIds: string[]) => {
  const flats: any[] = await Flat.find({ societyId, _id: { $in: flatIds } }).select('towerId');
  const towers = flats.map((f) => f.towerId).filter(Boolean);
  return { $or: [{ 'audience.all': true }, { 'audience.flatIds': { $in: flatIds.map(oid) } }, ...(towers.length ? [{ 'audience.towerIds': { $in: towers } }] : [])] };
};

export const noticeExtra = {
  async publish(societyId: string, userId: string, id: string) {
    const n: any = await Notice.findOneAndUpdate({ _id: id, societyId, status: { $in: ['DRAFT', 'ARCHIVED'] } }, { $set: { status: 'PUBLISHED', publishAt: new Date(), authorId: userId, updatedBy: userId } }, { new: true });
    if (!n) throw ApiError.conflict('Notice not found or already published', 'INVALID_STATE');
    const flatIds = n.audience?.all ? undefined : [...(n.audience.flatIds ?? []).map(String), ...(await Flat.find({ societyId, towerId: { $in: n.audience.towerIds ?? [] } }).select('_id')).map((f: any) => String(f._id))];
    await notifyAllResidents(societyId, { type: n.type === 'EMERGENCY' ? NotificationType.EMERGENCY : NotificationType.ANNOUNCEMENT, title: n.title, body: n.body.slice(0, 160), data: { noticeId: id, noticeType: n.type }, event: n.type === 'EMERGENCY' ? 'emergency:announcement' : 'notice:published' }, flatIds);
    return n;
  },
  async archive(societyId: string, userId: string, id: string) {
    const n = await Notice.findOneAndUpdate({ _id: id, societyId, status: 'PUBLISHED' }, { $set: { status: 'ARCHIVED', updatedBy: userId } }, { new: true });
    if (!n) throw ApiError.conflict('Only published notices can be archived', 'INVALID_STATE');
    return n;
  },
  async listForResident(societyId: string, flatIds: string[], q: any) {
    const now = new Date();
    const f: Record<string, any> = { societyId, status: 'PUBLISHED', $and: [{ $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }, await audienceFilter(societyId, flatIds)] };
    if (q.type) f.type = q.type;
    return paginate(Notice, applyListFilters(f, q, ['title', 'body']), q, { sortable: ['pinned', 'publishAt', 'createdAt'], defaultSort: '-pinned,-publishAt' });
  },
  async getForResident(societyId: string, flatIds: string[], id: string) {
    const n = await Notice.findOne({ _id: id, societyId, status: 'PUBLISHED', ...(await audienceFilter(societyId, flatIds)) });
    if (!n) throw ApiError.notFound('Notice not found');
    return n;
  },
};

export const pollExtra = {
  async setStatus(societyId: string, userId: string, id: string, to: 'ACTIVE' | 'CLOSED') {
    const from = to === 'ACTIVE' ? 'DRAFT' : 'ACTIVE';
    const p: any = await Poll.findOneAndUpdate({ _id: id, societyId, status: from }, { $set: { status: to, updatedBy: userId, ...(to === 'ACTIVE' ? { startsAt: new Date() } : { endsAt: new Date() }) } }, { new: true });
    if (!p) throw ApiError.conflict(`Poll must be ${from} to become ${to}`, 'INVALID_STATE');
    if (to === 'ACTIVE') await notifyAllResidents(societyId, { type: NotificationType.ANNOUNCEMENT, title: `New ${p.kind.toLowerCase()}: ${p.title}`, body: 'Cast your vote.', data: { pollId: id }, event: 'poll:opened' });
    return p;
  },
  async listForResident(societyId: string, flatIds: string[], q: any) {
    const f: Record<string, any> = { societyId, status: { $in: ['ACTIVE', 'CLOSED'] }, $and: [await audienceFilter(societyId, flatIds)] };
    ['kind', 'status'].forEach((k) => q[k] && (f[k] = q[k]));
    return paginate(Poll, applyListFilters(f, q, ['title']), q, { sortable: ['createdAt', 'endsAt'] });
  },
  async getForResident(societyId: string, flatIds: string[], id: string) {
    const p = await Poll.findOne({ _id: id, societyId, status: { $in: ['ACTIVE', 'CLOSED'] }, ...(await audienceFilter(societyId, flatIds)) });
    if (!p) throw ApiError.notFound('Poll not found');
    return p;
  },
  async vote(societyId: string, userId: string, residents: { flatId: string }[], id: string, body: any) {
    const p: any = await pollExtra.getForResident(societyId, residents.map((r) => r.flatId), id);
    const now = new Date();
    if (p.status !== 'ACTIVE' || (p.startsAt && now < p.startsAt) || (p.endsAt && now > p.endsAt)) throw ApiError.conflict('Voting is not open', 'VOTING_CLOSED');
    const flatId = body.flatId ?? residents[0]?.flatId;
    if (!residents.some((r) => r.flatId === flatId)) throw ApiError.forbidden('You do not belong to this flat', 'FLAT_FORBIDDEN');
    for (const q of p.questions) {
      const a = body.answers.find((x: any) => x.questionId === String(q._id));
      if (!a) {
        if (q.required) throw ApiError.badRequest(`Question "${q.text}" requires an answer`, 'ANSWER_REQUIRED');
        continue;
      }
      if (q.type === 'TEXT') {
        if (!a.text) throw ApiError.badRequest('A text answer is required', 'ANSWER_REQUIRED');
        continue;
      }
      const valid = new Set(q.options.map((o: any) => String(o._id)));
      if (!a.optionIds.length || a.optionIds.some((o: string) => !valid.has(o))) throw ApiError.badRequest('Invalid option selected', 'INVALID_OPTION');
      if (q.type === 'SINGLE_CHOICE' && a.optionIds.length !== 1) throw ApiError.badRequest('Select exactly one option', 'INVALID_OPTION');
    }
    const known = new Set(p.questions.map((q: any) => String(q._id)));
    if (body.answers.some((a: any) => !known.has(a.questionId))) throw ApiError.badRequest('Unknown question', 'INVALID_QUESTION');
    try {
      await Vote.create({ societyId, pollId: id, voteKey: p.onePerFlat ? `flat:${flatId}` : `user:${userId}`, userId, flatId, answers: body.answers, createdBy: userId });
    } catch (e: any) {
      if (e?.code === 11000) throw ApiError.conflict(p.onePerFlat ? 'Your flat has already voted' : 'You have already voted', 'ALREADY_VOTED');
      throw e;
    }
  },
  async results(societyId: string, id: string) {
    const p: any = await Poll.findOne({ _id: id, societyId });
    if (!p) throw ApiError.notFound('Poll not found');
    const totals = await Vote.aggregate([{ $match: { societyId: oid(societyId), pollId: oid(id) } }, { $unwind: '$answers' }, { $unwind: { path: '$answers.optionIds', preserveNullAndEmptyArrays: true } }, { $group: { _id: { q: '$answers.questionId', o: '$answers.optionIds' }, n: { $sum: 1 } } }]);
    const count = await Vote.countDocuments({ societyId, pollId: id });
    const texts: any[] = await Vote.find({ societyId, pollId: id, 'answers.text': { $exists: true } }).select('answers').limit(500);
    return {
      pollId: id,
      totalVotes: count,
      questions: p.questions.map((q: any) => {
        const row = (o: string | null) => totals.find((t: any) => String(t._id.q) === String(q._id) && String(t._id.o ?? null) === String(o))?.n ?? 0;
        return { questionId: String(q._id), text: q.text, responses: totals.filter((t: any) => String(t._id.q) === String(q._id)).reduce((s: number, t: any) => s + t.n, 0), options: q.options.map((o: any) => ({ optionId: String(o._id), label: o.label, votes: row(String(o._id)) })), ...(q.type === 'TEXT' ? { textAnswers: texts.flatMap((v) => v.answers.filter((a: any) => String(a.questionId) === String(q._id) && a.text).map((a: any) => a.text)) } : {}) };
      }),
    };
  },
  async hasVoted(societyId: string, userId: string, id: string) {
    return Boolean(await Vote.exists({ societyId, pollId: id, userId }));
  },
};

registerWorkflowEntity(ApprovalEntityType.COMMUNITY_POST, { model: CommunityPost, ownerField: 'authorId', label: (d) => d.title, summary: (d) => String(d.body).slice(0, 200), autoPublish: listingAutoPublish });

const PENDING_OWN = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'REJECTED'];
const toPlain = (d: any) => (d?.toJSON ? d.toJSON() : { ...d });
const idOf = (d: any) => String(d?.id ?? d?._id);

async function claimImages(societyId: string, userId: string, images?: string[]) {
  const ids = [...new Set((images ?? []).map(String))];
  if (!ids.length) return;
  const found = await File.countDocuments({ _id: { $in: ids }, societyId, uploadedBy: userId });
  if (found !== ids.length) throw ApiError.badRequest('One or more photos could not be found. Please upload them again.', 'FILE_NOT_FOUND');
  await File.updateMany({ _id: { $in: ids }, societyId, uploadedBy: userId }, { $set: { visibility: 'SOCIETY' } });
}

async function usersById(ids: unknown[]) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  const users: any[] = unique.length ? await User.find({ _id: { $in: unique } }).select('name avatarFileId') : [];
  return new Map(users.map((u) => [String(u._id), u]));
}

async function decoratePosts(societyId: string, docs: any[], viewerId?: string) {
  const items = docs.map(toPlain);
  if (!items.length) return items;
  const postIds = items.map(idOf);
  const users = await usersById(items.map((i) => i.authorId));
  const liked: any[] = viewerId ? await PostLike.find({ societyId, userId: viewerId, postId: { $in: postIds } }).select('postId') : [];
  const viewed: any[] = viewerId ? await PostView.find({ societyId, userId: viewerId, postId: { $in: postIds } }).select('postId') : [];
  const likedSet = new Set(liked.map((l) => String(l.postId)));
  const viewedSet = new Set(viewed.map((v) => String(v.postId)));
  return items.map((i) => {
    const u = users.get(String(i.authorId));
    const name = u?.name ?? i.authorName ?? 'Resident';
    return {
      ...i,
      authorId: String(i.authorId),
      authorName: name,
      images: (i.images ?? []).map(String),
      likeCount: Math.max(0, Number(i.likeCount ?? 0)),
      commentCount: Math.max(0, Number(i.commentCount ?? 0)),
      viewCount: Math.max(0, Number(i.viewCount ?? 0)),
      author: { id: String(i.authorId), name, avatarFileId: u?.avatarFileId ? String(u.avatarFileId) : undefined, flatLabel: i.flatLabel },
      liked: likedSet.has(idOf(i)),
      viewed: viewedSet.has(idOf(i)),
    };
  });
}

function shapeComment(c: any, users: Map<string, any>) {
  const j = toPlain(c);
  const u = users.get(String(j.userId));
  return {
    ...j,
    userId: String(j.userId),
    postId: String(j.postId),
    parentId: j.parentId ? String(j.parentId) : undefined,
    userName: u?.name ?? j.userName ?? 'Resident',
    userAvatarFileId: u?.avatarFileId ? String(u.avatarFileId) : undefined,
    replyCount: Math.max(0, Number(j.replyCount ?? 0)),
  };
}

export const postService = {
  async create(societyId: string, userId: string, flatIds: string[], body: any) {
    const user: any = await User.findById(userId).select('name');
    const flat: any = flatIds[0] ? await Flat.findOne({ _id: flatIds[0], societyId }) : null;
    const { saveAsDraft, ...data } = body;
    await claimImages(societyId, userId, data.images);
    const post: any = await CommunityPost.create({ ...data, societyId, authorId: userId, authorName: user?.name, flatLabel: flat?.label, createdBy: userId });
    return saveAsDraft ? post : postService.submit(societyId, userId, String(post._id));
  },
  async update(societyId: string, userId: string, id: string, body: any) {
    if (body.images) await claimImages(societyId, userId, body.images);
    const p = await CommunityPost.findOneAndUpdate({ _id: id, societyId, authorId: userId, status: { $in: ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'] } }, { $set: { ...body, updatedBy: userId } }, { new: true });
    if (!p) throw ApiError.conflict('Post not found or not editable in its current state', 'NOT_EDITABLE');
    return p;
  },
  async submit(societyId: string, userId: string, id: string) {
    const existing: any = await CommunityPost.findOne({ _id: id, societyId, authorId: userId });
    if (!existing) throw ApiError.notFound('Post not found');
    if (['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'PUBLISHED'].includes(existing.status)) return existing;
    if (existing.status === 'REJECTED') await applyTransition('COMMUNITY_POST', id, 'DRAFT', { userId, role: 'RESIDENT', societyId }, { ownerOnly: true });
    const p = await applyTransition('COMMUNITY_POST', id, 'SUBMITTED', { userId, role: 'RESIDENT', societyId }, { ownerOnly: true });
    const approval: any = await ApprovalRequest.findOne({ societyId, entityType: 'COMMUNITY_POST', entityId: id }).select('_id');
    const payload = { entityType: 'COMMUNITY_POST', entityId: id, approvalId: approval ? String(approval._id) : undefined, title: p.title };
    await notifyAdmins(societyId, 'approval:review', { type: NotificationType.APPROVAL, title: 'Community post awaiting approval', body: p.title, data: { ...payload, route: 'approvals' } });
    realtime.toAdmins(societyId, 'approval:new', payload);
    return p;
  },
  withdraw: (societyId: string, userId: string, id: string) => applyTransition('COMMUNITY_POST', id, 'DRAFT', { userId, role: 'RESIDENT', societyId }, { ownerOnly: true }),
  async mine(societyId: string, userId: string, q: any) {
    const r = await paginate(CommunityPost, applyListFilters({ societyId, authorId: userId, ...(q.status ? { status: q.status } : {}) }, q, ['title', 'body']), q, { sortable: ['createdAt', 'publishedAt'], defaultSort: '-createdAt' });
    return { ...r, items: await decoratePosts(societyId, r.items, userId) };
  },
  async feed(societyId: string, q: any, userId?: string) {
    const r = await paginate(CommunityPost, applyListFilters({ societyId, status: { $in: VISIBLE_STATUSES } }, q, ['title', 'body']), q, { sortable: ['publishedAt', 'likeCount', 'viewCount', 'createdAt'], defaultSort: '-publishedAt,-createdAt' });
    return { ...r, items: await decoratePosts(societyId, r.items, userId) };
  },
  async get(societyId: string, userId: string, id: string) {
    const p = await CommunityPost.findOne({ _id: id, societyId, $or: [{ status: { $in: VISIBLE_STATUSES } }, { authorId: userId, status: { $in: PENDING_OWN } }] });
    if (!p) throw ApiError.notFound('Post not found');
    const [one] = await decoratePosts(societyId, [p], userId);
    return one;
  },
  async visible(societyId: string, id: string) {
    const p = await CommunityPost.findOne({ _id: id, societyId, status: { $in: VISIBLE_STATUSES } });
    if (!p) throw ApiError.notFound('Post not found');
    return p;
  },
  async view(societyId: string, userId: string, id: string) {
    const p: any = await postService.visible(societyId, id);
    if (String(p.authorId) === userId) return { viewCount: Math.max(0, Number(p.viewCount ?? 0)), viewed: true };
    let inserted = false;
    try {
      const r = await PostView.updateOne({ societyId, postId: id, userId }, { $setOnInsert: { userId } }, { upsert: true });
      inserted = r.upsertedCount > 0;
    } catch (e: any) {
      if (e?.code !== 11000) throw e;
    }
    if (inserted) await CommunityPost.updateOne({ _id: id, societyId }, { $inc: { viewCount: 1 } });
    const fresh: any = await CommunityPost.findOne({ _id: id, societyId }).select('viewCount');
    return { viewCount: Math.max(0, Number(fresh?.viewCount ?? 0)), viewed: true };
  },
  async comment(societyId: string, userId: string, id: string, text: string, parentId?: string) {
    await postService.visible(societyId, id);
    let rootId: any;
    if (parentId) {
      const parent: any = await PostComment.findOne({ _id: parentId, societyId, postId: id });
      if (!parent) throw ApiError.notFound('The comment you are replying to no longer exists');
      rootId = parent.parentId ?? parent._id;
    }
    const u: any = await User.findById(userId).select('name avatarFileId');
    const c = await PostComment.create({ societyId, postId: id, userId, userName: u?.name, text, ...(rootId ? { parentId: rootId } : {}) });
    await CommunityPost.updateOne({ _id: id, societyId }, { $inc: { commentCount: 1 } });
    if (rootId) await PostComment.updateOne({ _id: rootId, societyId }, { $inc: { replyCount: 1 } });
    return { ...shapeComment(c, new Map([[userId, u]])), replies: [] };
  },
  async comments(societyId: string, id: string, q: any) {
    await postService.visible(societyId, id);
    const r = await paginate(PostComment, { societyId, postId: id, parentId: null }, q, { sortable: ['createdAt'], defaultSort: 'createdAt' });
    const topIds = r.items.map((c: any) => c._id);
    const replies: any[] = topIds.length ? await PostComment.find({ societyId, postId: id, parentId: { $in: topIds } }).sort({ createdAt: 1 }).limit(1000) : [];
    const users = await usersById([...r.items.map((c: any) => c.userId), ...replies.map((c) => c.userId)]);
    const byParent = new Map<string, any[]>();
    replies.forEach((c) => {
      const k = String(c.parentId);
      byParent.set(k, [...(byParent.get(k) ?? []), shapeComment(c, users)]);
    });
    return { ...r, items: r.items.map((c: any) => ({ ...shapeComment(c, users), replies: byParent.get(String(c._id)) ?? [] })) };
  },
  async like(societyId: string, userId: string, id: string, on: boolean) {
    await postService.visible(societyId, id);
    if (on) {
      const r = await PostLike.updateOne({ societyId, postId: id, userId }, { $setOnInsert: { createdBy: userId } }, { upsert: true });
      if (r.upsertedCount) await CommunityPost.updateOne({ _id: id, societyId }, { $inc: { likeCount: 1 } });
    } else {
      const r = await PostLike.deleteOne({ societyId, postId: id, userId });
      if (r.deletedCount) await CommunityPost.updateOne({ _id: id, societyId, likeCount: { $gt: 0 } }, { $inc: { likeCount: -1 } });
    }
    const fresh: any = await CommunityPost.findOne({ _id: id, societyId }).select('likeCount');
    return { liked: on, likeCount: Math.max(0, Number(fresh?.likeCount ?? 0)) };
  },
  async adminList(societyId: string, q: any) {
    const r: any = await paginate(CommunityPost, applyListFilters({ societyId, ...(q.status ? { status: q.status } : {}) }, q, ['title', 'body']), q, { sortable: ['createdAt'] });
    return postService.withAuthors(societyId, r);
  },
  async adminRemove(societyId: string, actorId: string, id: string, reason?: string) {
    const p: any = await CommunityPost.findOne({ _id: id, societyId });
    if (!p) throw ApiError.notFound('Post not found');
    const actor = { userId: actorId, role: 'SOCIETY_ADMIN', societyId };
    if (['SUBMITTED', 'UNDER_REVIEW'].includes(p.status)) await applyTransition('COMMUNITY_POST', id, 'REJECTED', actor, { reason: reason ?? 'Removed by the society admin.' });
    else await applyTransition('COMMUNITY_POST', id, 'REMOVED', actor, { reason });
    return postService.adminGet(societyId, id);
  },
  async adminGet(societyId: string, id: string) {
    const p: any = await CommunityPost.findOne({ _id: id, societyId });
    if (!p) throw ApiError.notFound('Post not found');
    const [one] = (await postService.withAuthors(societyId, { items: [p.toJSON ? p.toJSON() : p] })).items;
    return one;
  },
  async withAuthors(societyId: string, r: any) {
    const items: any[] = (r.items ?? r.data ?? []).map((i: any) => (i?.toJSON ? i.toJSON() : i));
    const users: any[] = await User.find({ _id: { $in: items.map((i) => i.authorId) } }).select('name mobile avatarFileId');
    const m = new Map(users.map((u) => [String(u._id), u]));
    const mapped = items.map((i) => {
      const u = m.get(String(i.authorId));
      return { ...i, authorName: u?.name ?? i.authorName, authorMobile: u?.mobile, images: (i.images ?? []).map(String), author: { id: String(i.authorId), name: u?.name ?? i.authorName ?? 'Resident', avatarFileId: u?.avatarFileId ? String(u.avatarFileId) : undefined, flatLabel: i.flatLabel } };
    });
    return r.items ? { ...r, items: mapped } : { ...r, data: mapped };
  },
};

export async function directory(societyId: string, q: any) {
  const r = await paginate(Resident, { societyId, status: 'APPROVED', residentType: { $ne: 'FAMILY_MEMBER' } }, q, { sortable: ['createdAt'], populate: [{ path: 'userId', select: 'name' }, { path: 'flatId', select: 'label' }] });
  const items = r.items.map((x: any) => ({ userId: String(x.userId?._id ?? x.userId), name: x.userId?.name, flatLabel: x.flatId?.label, residentType: x.residentType }));
  const needle = q.search?.toLowerCase();
  return { ...r, items: needle ? items.filter((i: any) => i.name?.toLowerCase().includes(needle) || i.flatLabel?.toLowerCase().includes(needle)) : items };
}
