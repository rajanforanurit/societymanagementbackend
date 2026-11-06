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
import { CommunityPost, Notice, Poll, PostComment, PostLike, Vote } from './community.model';

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

export const postService = {
  async create(societyId: string, userId: string, flatIds: string[], body: any) {
    const user: any = await User.findById(userId).select('name');
    const flat: any = flatIds[0] ? await Flat.findOne({ _id: flatIds[0], societyId }) : null;
    return CommunityPost.create({ ...body, societyId, authorId: userId, authorName: user?.name, flatLabel: flat?.label, createdBy: userId });
  },
  async update(societyId: string, userId: string, id: string, body: any) {
    const p = await CommunityPost.findOneAndUpdate({ _id: id, societyId, authorId: userId, status: { $in: ['DRAFT', 'CHANGES_REQUESTED', 'REJECTED'] } }, { $set: { ...body, updatedBy: userId } }, { new: true });
    if (!p) throw ApiError.conflict('Post not found or not editable in its current state', 'NOT_EDITABLE');
    return p;
  },
  async submit(societyId: string, userId: string, id: string) {
    const p = await applyTransition('COMMUNITY_POST', id, 'SUBMITTED', { userId, role: 'RESIDENT', societyId }, { ownerOnly: true });
    await notifyAdmins(societyId, 'approval:review', { type: NotificationType.APPROVAL, title: 'Community post awaiting approval', body: p.title, data: { entityType: 'COMMUNITY_POST', entityId: id } });
    return p;
  },
  withdraw: (societyId: string, userId: string, id: string) => applyTransition('COMMUNITY_POST', id, 'DRAFT', { userId, role: 'RESIDENT', societyId }, { ownerOnly: true }),
  async mine(societyId: string, userId: string, q: any) {
    return paginate(CommunityPost, applyListFilters({ societyId, authorId: userId, ...(q.status ? { status: q.status } : {}) }, q, ['title']), q, { sortable: ['createdAt'] });
  },
  async feed(societyId: string, q: any) {
    return paginate(CommunityPost, applyListFilters({ societyId, status: { $in: VISIBLE_STATUSES } }, q, ['title', 'body']), q, { sortable: ['publishedAt', 'likeCount', 'createdAt'], defaultSort: '-publishedAt' });
  },
  async visible(societyId: string, id: string) {
    const p = await CommunityPost.findOne({ _id: id, societyId, status: { $in: VISIBLE_STATUSES } });
    if (!p) throw ApiError.notFound('Post not found');
    return p;
  },
  async comment(societyId: string, userId: string, id: string, text: string) {
    await postService.visible(societyId, id);
    const u: any = await User.findById(userId).select('name');
    const c = await PostComment.create({ societyId, postId: id, userId, userName: u?.name, text, createdBy: userId });
    await CommunityPost.updateOne({ _id: id, societyId }, { $inc: { commentCount: 1 } });
    return c;
  },
  async comments(societyId: string, id: string, q: any) {
    await postService.visible(societyId, id);
    return paginate(PostComment, { societyId, postId: id }, q, { sortable: ['createdAt'], defaultSort: 'createdAt' });
  },
  async like(societyId: string, userId: string, id: string, on: boolean) {
    await postService.visible(societyId, id);
    if (on) {
      const r = await PostLike.updateOne({ societyId, postId: id, userId }, { $setOnInsert: { createdBy: userId } }, { upsert: true });
      if (r.upsertedCount) await CommunityPost.updateOne({ _id: id, societyId }, { $inc: { likeCount: 1 } });
    } else {
      const r = await PostLike.deleteOne({ societyId, postId: id, userId });
      if (r.deletedCount) await CommunityPost.updateOne({ _id: id, societyId }, { $inc: { likeCount: -1 } });
    }
  },
  async adminList(societyId: string, q: any) {
    return paginate(CommunityPost, applyListFilters({ societyId, ...(q.status ? { status: q.status } : {}) }, q, ['title', 'body']), q, { sortable: ['createdAt'] });
  },
};

export async function directory(societyId: string, q: any) {
  const r = await paginate(Resident, { societyId, status: 'APPROVED', residentType: { $ne: 'FAMILY_MEMBER' } }, q, { sortable: ['createdAt'], populate: [{ path: 'userId', select: 'name' }, { path: 'flatId', select: 'label' }] });
  const items = r.items.map((x: any) => ({ userId: String(x.userId?._id ?? x.userId), name: x.userId?.name, flatLabel: x.flatId?.label, residentType: x.residentType }));
  const needle = q.search?.toLowerCase();
  return { ...r, items: needle ? items.filter((i: any) => i.name?.toLowerCase().includes(needle) || i.flatLabel?.toLowerCase().includes(needle)) : items };
}
