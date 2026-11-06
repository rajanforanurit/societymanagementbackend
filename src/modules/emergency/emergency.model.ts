import { AlertStatus, EmergencyType, IncidentStatus, IncidentType, LostFoundStatus, LostFoundType, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const EmergencyAlert = defineModel(
  'EmergencyAlert',
  makeSchema(
    {
      type: { type: String, enum: vals(EmergencyType), default: 'PANIC' },
      source: { type: String, enum: ['RESIDENT', 'GUARD', 'ADMIN'], required: true },
      raisedBy: refReq('User'),
      flatId: ref('Flat'),
      flatLabel: String,
      gateId: ref('Gate'),
      location: String,
      message: String,
      status: { type: String, enum: vals(AlertStatus), default: 'ACTIVE', index: true },
      acknowledgedBy: ref('User'),
      acknowledgedAt: Date,
      resolvedBy: ref('User'),
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
    },
    { indexes: [[{ societyId: 1, scope: 1, order: 1 }]] },
  ),
);
