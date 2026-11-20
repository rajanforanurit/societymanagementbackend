import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const CALL_STATUSES = ['RINGING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'MISSED', 'ENDED'] as const;

/**
 * One document per call attempt. Audio itself travels peer-to-peer over WebRTC (via STUN/TURN);
 * this record only tracks who called whom and the call state. Signaling goes over Socket.IO.
 */
export const Call = defineModel(
  'Call',
  makeSchema(
    {
      callerId: refReq('User', { index: true }),
      calleeId: refReq('User', { index: true }),
      callerRole: { type: String, required: true },
      calleeRole: { type: String, required: true },
      callerName: String,
      callerLabel: String, // flat for residents, gate for guards, designation for admins
      calleeName: String,
      calleeLabel: String,
      status: { type: String, enum: CALL_STATUSES, default: 'RINGING', index: true },
      answeredAt: Date,
      endedAt: Date,
      endedBy: ref('User'),
      endReason: String,
    },
    { audited: false, indexes: [[{ societyId: 1, status: 1, createdAt: -1 }], [{ societyId: 1, callerId: 1, createdAt: -1 }], [{ societyId: 1, calleeId: 1, createdAt: -1 }]] },
  ),
);
