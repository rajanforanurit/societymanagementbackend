import { AlertStatus, EmergencyType, IncidentStatus, IncidentType, LostFoundStatus, LostFoundType, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const EmergencyAlert = defineModel(
  'EmergencyAlert',
  makeSchema(
    {
      type: { type: String, enum: vals(EmergencyType), default: 'PANIC' },
      source: { type: String, enum: ['RESIDENT', 'GUARD', 'ADMIN'], required: true },
      raisedBy: refReq('User'),
      raisedByName: String,
      flatId: ref('Flat'),
      flatLabel: String,
      gateId: ref('Gate'),
      location: String,
      message: String,
      status: { type: String, enum: vals(AlertStatus), default: 'ACTIVE', index: true },
      acknowledgedBy: ref('User'),
      acknowledgedByName: String,
      acknowledgedByRole: String,
      acknowledgedAt: Date,
      resolvedBy: ref('User'),
      resolvedByName: String,
      resolvedByRole: String,
      resolvedAt: Date,
      resolutionNote: String,
      notifiedContacts: [{ name: String, phone: String }],
    },
    { indexes: [[{ societyId: 1, status: 1, createdAt: -1 }]] },
  ),
);

export const SecurityIncident = defineModel(
  'SecurityIncident',
  makeSchema(
    {
      reportedBy: refReq('User'),
      reporterRole: String,
      type: { type: String, enum: vals(IncidentType), default: 'OTHER' },
      description: { type: String, required: true },
      location: String,
      flatId: ref('Flat'),
      attachments: [ref('File')],
      status: { type: String, enum: vals(IncidentStatus), default: 'OPEN', index: true },
      resolutionNote: String,
    },
    { indexes: [[{ societyId: 1, status: 1, createdAt: -1 }]] },
  ),
);

export const LostFoundItem = defineModel(
  'LostFoundItem',
  makeSchema(
    {
      type: { type: String, enum: vals(LostFoundType), required: true },
      reportedBy: refReq('User'),
      title: { type: String, required: true },
      description: String,
      locationFound: String,
      images: [ref('File')],
      status: { type: String, enum: vals(LostFoundStatus), default: 'OPEN', index: true },
    },
    { indexes: [[{ societyId: 1, status: 1, createdAt: -1 }]] },
  ),
);

export const EmergencyContact = defineModel(
  'EmergencyContact',
  makeSchema(
    {
      scope: { type: String, enum: ['SOCIETY', 'PERSONAL'], default: 'SOCIETY', index: true },
      ownerUserId: ref('User', { index: true }),
      name: { type: String, required: true },
      category: { type: String, default: 'OTHER' },
      phone: { type: String, required: true },
      notes: String,
      order: { type: Number, default: 0 },
      // The society admin chooses who sees each number (older documents without flags stay visible).
      visibleToResidents: { type: Boolean, default: true },
      visibleToGuards: { type: Boolean, default: true },
    },
    { indexes: [[{ societyId: 1, scope: 1, order: 1 }]] },
  ),
);

/**
 * One document per (society, resident), `_id = "<societyId>:<userId>"`. `lastAlarmAt` is claimed
 * atomically so accidental double taps cannot raise duplicate alarms. Keying by _id needs no extra
 * index (autoIndex is off in production).
 */
export const EmergencyAlarmLock = defineModel(
  'EmergencyAlarmLock',
  makeSchema({ _id: { type: String }, userId: ref('User'), lastAlarmAt: Date }, { softDelete: false, audited: false }),
);

/** Free-text emergency messages from residents to the guards or the society admins. */
export const EmergencyStaffMessage = defineModel(
  'EmergencyStaffMessage',
  makeSchema(
    {
      fromUserId: refReq('User', { index: true }),
      fromName: String,
      flatLabel: String,
      audience: { type: String, enum: ['GUARDS', 'ADMIN'], required: true },
      subject: String,
      message: { type: String, required: true },
    },
    { audited: false, indexes: [[{ societyId: 1, audience: 1, createdAt: -1 }]] },
  ),
);
