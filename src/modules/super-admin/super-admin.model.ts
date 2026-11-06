import { model, Schema } from 'mongoose';
import { Audience, BillingCycle, FEATURE_KEYS, Severity, TicketCategory, TicketStatus, Priority, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

const featureFlags = Object.fromEntries(FEATURE_KEYS.map((k) => [k, { type: Boolean, default: true }]));

export const Organization = defineModel(
  'Organization',
  makeSchema(
    {
      name: { type: String, required: true, trim: true },
      contactEmail: String,
      contactPhone: String,
      address: String,
      status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    },
    { tenant: false, indexes: [[{ name: 'text' }]] },
  ),
);

export const SubscriptionPlan = defineModel(
  'SubscriptionPlan',
  makeSchema(
    {
      name: { type: String, required: true },
      code: { type: String, required: true, uppercase: true },
      price: { type: Number, default: 0 },
      billingCycle: { type: String, enum: vals(BillingCycle), default: 'MONTHLY' },
      features: featureFlags,
      limits: { maxFlats: Number, maxGuards: Number, maxAdmins: Number },
      isActive: { type: Boolean, default: true },
    },
    { tenant: false, indexes: [[{ code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);

export const ImpersonationSession = defineModel(
  'ImpersonationSession',
  makeSchema(
    {
      superAdminId: refReq('User', { index: true }),
      societyId: refReq('Society', { index: true }),
      reason: { type: String, required: true },
      startedAt: { type: Date, default: Date.now },
      expiresAt: { type: Date, required: true },
      endedAt: Date,
      ip: String,
    },
    { tenant: false, softDelete: false, audited: false },
  ),
);

export const PlatformAnnouncement = defineModel(
  'PlatformAnnouncement',
  makeSchema(
    {
      title: { type: String, required: true },
      body: { type: String, required: true },
      severity: { type: String, enum: vals(Severity), default: 'INFO' },
      audience: { type: String, enum: vals(Audience), default: 'ALL' },
      societyIds: [ref('Society')],
      startsAt: { type: Date, default: Date.now },
      endsAt: Date,
      isActive: { type: Boolean, default: true },
    },
    { tenant: false },
  ),
);

export const AppConfig = defineModel(
  'AppConfig',
  makeSchema(
    { key: { type: String, required: true, trim: true }, value: Schema.Types.Mixed, description: String },
    { tenant: false, softDelete: false, indexes: [[{ key: 1 }, { unique: true }]] },
  ),
);

export const NotificationTemplate = defineModel(
  'NotificationTemplate',
  makeSchema(
    {
      key: { type: String, required: true, uppercase: true },
      channel: { type: String, enum: ['PUSH', 'SMS', 'EMAIL', 'IN_APP'], default: 'IN_APP' },
      title: { type: String, required: true },
      body: { type: String, required: true },
      locale: { type: String, default: 'en' },
      isActive: { type: Boolean, default: true },
    },
    { tenant: false, indexes: [[{ key: 1, channel: 1, locale: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);

export const ErrorLog = defineModel(
  'ErrorLog',
  makeSchema(
    {
      requestId: String,
      method: String,
      path: String,
      status: { type: Number, index: true },
      code: String,
      message: String,
      stack: String,
      userId: ref('User'),
      societyId: ref('Society', { index: true }),
      ip: String,
    },
    { tenant: false, softDelete: false, audited: false, indexes: [[{ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 }], [{ status: 1, createdAt: -1 }]] },
  ),
);

export const SupportTicket = defineModel(
  'SupportTicket',
  makeSchema(
    {
      ticketNumber: { type: String, required: true },
      societyId: ref('Society', { index: true }),
      raisedBy: refReq('User'),
      subject: { type: String, required: true },
      description: { type: String, required: true },
      category: { type: String, enum: vals(TicketCategory), default: 'OTHER' },
      priority: { type: String, enum: vals(Priority), default: 'MEDIUM' },
      status: { type: String, enum: vals(TicketStatus), default: 'OPEN', index: true },
      assignedTo: ref('User'),
      attachments: [ref('File')],
      comments: [{ authorId: refReq('User'), authorRole: String, message: { type: String, required: true }, createdAt: { type: Date, default: Date.now } }],
      resolvedAt: Date,
    },
    { tenant: false, indexes: [[{ ticketNumber: 1 }, { unique: true }], [{ societyId: 1, status: 1, createdAt: -1 }]] },
  ),
);
