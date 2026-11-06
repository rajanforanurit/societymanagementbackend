import { createHash } from 'crypto';
import { model } from 'mongoose';
import { defineModel, makeSchema, ref } from '../../common/models/makeSchema';

const schema = makeSchema(
  {
    actorId: ref('User', { index: true }),
    actorRole: String,
    societyId: ref('Society', { index: true }),
    action: { type: String, required: true, index: true },
    entityType: String,
    entityId: String,
    before: Object,
    after: Object,
    metadata: Object,
    statusCode: Number,
    impersonationId: ref('ImpersonationSession', { index: true }),
    ip: String,
    requestId: String,
    hash: String,
  },
  {
    tenant: false,
    softDelete: false,
    audited: false,
    immutable: true,
    indexes: [[{ societyId: 1, createdAt: -1 }], [{ entityType: 1, entityId: 1, createdAt: -1 }], [{ actorId: 1, createdAt: -1 }]],
  },
);

schema.pre('save', function (this: any) {
  const payload = JSON.stringify([this.actorId, this.societyId, this.action, this.entityType, this.entityId, this.before, this.after, this.statusCode, this.impersonationId, new Date().toISOString()]);
  this.hash = createHash('sha256').update(payload).digest('hex');
});

export const AuditLog = defineModel('AuditLog', schema);
