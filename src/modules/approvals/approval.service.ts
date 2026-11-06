import { ClientSession, Model } from 'mongoose';
import { ApprovalEntityType, ApprovalStatus, NotificationType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { withTransaction } from '../../common/utils/transaction';
import { writeAudit } from '../audit/audit.service';
import { notifyUsers } from '../notifications/notify.service';
import { Society } from '../society/society.model';
import { ApprovalRequest } from './approval.model';

type S = ApprovalStatus;

export const TRANSITIONS: Record<S, S[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'DRAFT'],
  UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'DRAFT'],
  CHANGES_REQUESTED: ['SUBMITTED', 'DRAFT'],
  APPROVED: ['PUBLISHED', 'REMOVED', 'SUSPENDED', 'DRAFT'],
  REJECTED: ['DRAFT', 'REMOVED'],
  PUBLISHED: ['EXPIRED', 'REMOVED', 'SUSPENDED', 'DRAFT'],
  EXPIRED: ['SUBMITTED', 'REMOVED'],
  SUSPENDED: ['PUBLISHED', 'REMOVED'],
  REMOVED: [],
};

export const VISIBLE_STATUSES: S[] = ['APPROVED', 'PUBLISHED'];

export interface WorkflowEntity {
  model: Model<any>;
  label: (doc: any) => string;
  ownerField: string;
  summary?: (doc: any) => string | undefined;
  autoPublish?: (societyId: string) => Promise<boolean>;
  onApproved?: (doc: any, session?: ClientSession) => Promise<void>;
}

const registry = new Map<string, WorkflowEntity>();
export const registerWorkflowEntity = (type: ApprovalEntityType, def: WorkflowEntity) => registry.set(type, def);
const entityDef = (type: string) => {
  const d = registry.get(type);
  if (!d) throw ApiError.badRequest(`Unsupported entity type ${type}`);
  return d;
};

export interface Actor {
  userId: string;
  role: string;
  societyId: string;
}

export async function applyTransition(type: ApprovalEntityType, entityId: string, to: S, actor: Actor, opts: { reason?: string; ownerOnly?: boolean } = {}, outer?: ClientSession) {
  const def = entityDef(type);
  const run = async (session?: ClientSession) => {
    const doc: any = await def.model.findOne({ _id: entityId, societyId: actor.societyId }).session(session ?? null);
    if (!doc) throw ApiError.notFound('Item not found');
    if (opts.ownerOnly && String(doc[def.ownerField]) !== actor.userId) throw ApiError.notFound('Item not found');
    const from: S = doc.status;
    if (!TRANSITIONS[from]?.includes(to)) throw ApiError.conflict(`Cannot move from ${from} to ${to}`, 'INVALID_TRANSITION', { from, to, allowed: TRANSITIONS[from] });
    if (['REJECTED', 'CHANGES_REQUESTED', 'SUSPENDED'].includes(to) && !opts.reason) throw ApiError.badRequest('A reason is required for this action', 'REASON_REQUIRED');
    const set: Record<string, unknown> = { status: to, updatedBy: actor.userId };
    if (to === 'PUBLISHED' || to === 'APPROVED') set.publishedAt = set.publishedAt ?? new Date();
    if (to === 'REJECTED' || to === 'CHANGES_REQUESTED' || to === 'SUSPENDED') set.rejectionReason = opts.reason;
    const claimed = await def.model.updateOne({ _id: entityId, societyId: actor.societyId, status: from }, { $set: set }, { session });
    if (claimed.modifiedCount !== 1) throw ApiError.conflict('Item was modified concurrently, please retry', 'CONCURRENT_UPDATE');
    const isSubmit = to === 'SUBMITTED';
    const update: Record<string, any> = {
      $set: { status: to, title: def.label(doc), summary: def.summary?.(doc), ...(isSubmit ? { submittedBy: doc[def.ownerField], submittedAt: new Date() } : {}), ...(['APPROVED', 'REJECTED', 'PUBLISHED'].includes(to) ? { decidedAt: new Date(), reviewerId: actor.userId } : {}) },
      $setOnInsert: { createdBy: actor.userId },
      $push: { history: { from, to, by: actor.userId, byRole: actor.role, reason: opts.reason, at: new Date() } },
    };
    if (isSubmit && from !== 'DRAFT') update.$inc = { version: 1 };
    const approval: any = await ApprovalRequest.findOneAndUpdate({ societyId: actor.societyId, entityType: type, entityId }, update, { upsert: true, new: true, session, setDefaultsOnInsert: true });
    await writeAudit({ actorId: actor.userId, actorRole: actor.role, societyId: actor.societyId, action: `APPROVAL_${to}`, entityType: type, entityId, before: { status: from }, after: { status: to }, metadata: { reason: opts.reason, approvalId: String(approval._id) } }, session);
    if (to === 'APPROVED') {
      const auto = def.autoPublish ? await def.autoPublish(actor.societyId) : false;
      if (def.onApproved) await def.onApproved(doc, session);
      if (auto) return { doc, approval, chain: true };
    }
    return { doc, approval, chain: false };
  };
  const result = outer ? await run(outer) : await withTransaction(run);
  const ownerId = String(result.doc[def.ownerField]);
  if (ownerId !== actor.userId && ['APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'SUSPENDED', 'REMOVED', 'PUBLISHED'].includes(to)) {
    await notifyUsers({ societyId: actor.societyId, userIds: [ownerId], type: NotificationType.APPROVAL, title: `${def.label(result.doc)}: ${to.replace('_', ' ').toLowerCase()}`, body: opts.reason ?? `Your submission is now ${to.toLowerCase().replace('_', ' ')}.`, data: { entityType: type, entityId, status: to }, event: 'approval:updated' });
  }
  if (result.chain) return applyTransition(type, entityId, 'PUBLISHED', actor, {}, outer);
  return (await def.model.findOne({ _id: entityId, societyId: actor.societyId })) as any;
}

export async function listingAutoPublish(societyId: string) {
  const s: any = await Society.findById(societyId).select('settings.listing');
  return s?.settings?.listing?.autoPublish !== false;
}

export async function getApproval(societyId: string, id: string) {
  const a = await ApprovalRequest.findOne({ _id: id, societyId });
  if (!a) throw ApiError.notFound('Approval request not found');
  return a;
}
