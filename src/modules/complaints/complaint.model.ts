import { AssigneeType, ComplaintCategory, ComplaintStatus, Priority, vals } from '../../common/constants/enums';
import { Schema } from 'mongoose';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const Complaint = defineModel(
  'Complaint',
  makeSchema(
    {
      ticketNumber: { type: String, required: true },
      flatId: ref('Flat', { index: true }),
      flatLabel: String,
      raisedBy: refReq('User', { index: true }),
      category: { type: String, enum: vals(ComplaintCategory), required: true, index: true },
      title: { type: String, required: true, trim: true },
      description: { type: String, required: true },
      priority: { type: String, enum: vals(Priority), default: 'MEDIUM', index: true },
      status: { type: String, enum: vals(ComplaintStatus), default: 'OPEN', index: true },
      attachments: [ref('File')],
      assignee: { type: { type: String, enum: vals(AssigneeType) }, refId: { type: Schema.Types.ObjectId }, name: String },
      assignedAt: Date,
      slaHours: Number,
      dueAt: { type: Date, index: true },
      escalationLevel: { type: Number, default: 0 },
      escalatedAt: Date,
      resolvedAt: Date,
      closedAt: Date,
      reopenedCount: { type: Number, default: 0 },
      rating: { score: { type: Number, min: 1, max: 5 }, feedback: String, at: Date },
      comments: [{ authorId: refReq('User'), authorRole: String, message: { type: String, required: true }, isInternal: { type: Boolean, default: false }, attachments: [ref('File')], at: { type: Date, default: Date.now } }],
      history: [{ status: String, by: ref('User'), note: String, at: { type: Date, default: Date.now } }],
    },
    { indexes: [[{ societyId: 1, ticketNumber: 1 }, { unique: true }], [{ societyId: 1, status: 1, createdAt: -1 }], [{ societyId: 1, status: 1, dueAt: 1 }], [{ societyId: 1, raisedBy: 1, createdAt: -1 }]] },
  ),
);

export const ComplaintAssignment = defineModel(
  'ComplaintAssignment',
  makeSchema(
    { complaintId: refReq('Complaint', { index: true }), assigneeType: { type: String, enum: vals(AssigneeType), required: true }, assigneeId: { type: Schema.Types.ObjectId, required: true }, assigneeName: String, assignedBy: ref('User'), note: String, active: { type: Boolean, default: true } },
    { indexes: [[{ societyId: 1, complaintId: 1, createdAt: -1 }], [{ societyId: 1, assigneeType: 1, assigneeId: 1, active: 1 }]] },
  ),
);

export const Counter = defineModel('Counter', makeSchema({ key: { type: String, required: true }, seq: { type: Number, default: 0 } }, { tenant: false, softDelete: false, audited: false, indexes: [[{ key: 1 }, { unique: true }]] }));
