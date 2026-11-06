import { z } from 'zod';
import { FEATURE_KEYS, FeeType, FlatStatus, Priority, Shift, SocietyStatus, SocietyType, TimeoutAction, VisitorType, Weekday, vals } from '../../common/constants/enums';
import { entity, globalEntity } from '../../common/responses/schemas';
import { address, email, hhmm, listQuery, mobile, objectId, password, dateTime } from '../../common/validators/common';

const featureFlags = z.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean().optional()])) as Record<(typeof FEATURE_KEYS)[number], z.ZodOptional<z.ZodBoolean>>);
const contact = z.object({ email: email.optional(), phone: z.string().max(20).optional(), emergencyPhone: z.string().max(20).optional(), website: z.string().max(200).optional() });

export const primaryAdminInput = z.object({ name: z.string().trim().min(2).max(120), mobile, email: email.optional(), password });

export const createSocietyBody = z.object({
  name: z.string().trim().min(2).max(200),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/, 'Use 3-20 letters, digits or hyphens'),
  type: z.enum(vals(SocietyType)).default('APARTMENT'),
  organizationId: objectId.optional(),
  planId: objectId.optional(),
  address: address.optional(),
  contact: contact.optional(),
  registrationNumber: z.string().max(60).optional(),
  totalUnits: z.number().int().min(1).max(100000).optional(),
  primaryAdmin: primaryAdminInput,
});

export const registerSocietyBody = z.object({
  name: z.string().trim().min(2).max(200),
  code: createSocietyBody.shape.code,
  type: z.enum(vals(SocietyType)).default('APARTMENT'),
  address: address.optional(),
  contact: contact.optional(),
  totalUnits: z.number().int().min(1).max(100000).optional(),
  applicant: z.object({ name: z.string().trim().min(2).max(120), email, mobile, notes: z.string().max(1000).optional() }),
});

export const updateSocietyBody = z.object({
  name: z.string().trim().min(2).max(200),
  type: z.enum(vals(SocietyType)),
  organizationId: objectId,
  address,
  contact,
  registrationNumber: z.string().max(60),
  totalUnits: z.number().int().min(1).max(100000),
  logoFileId: objectId,
}).partial();

export const societyListQuery = listQuery.extend({ status: z.enum(vals(SocietyStatus)).optional(), organizationId: objectId.optional(), type: z.enum(vals(SocietyType)).optional() });
export const statusBody = z.object({ reason: z.string().trim().max(500).optional() });
export const featuresBody = z.object({ features: featureFlags });
export const planBody = z.object({ planId: objectId, applyPlanFeatures: z.boolean().default(true), subscriptionEndsAt: dateTime.optional() });

const visitorPolicy = z.object({
  approvalRequired: z.object(Object.fromEntries(vals(VisitorType).map((k) => [k, z.boolean().optional()])) as any).optional(),
  deliveryApprovalRequired: z.boolean().optional(),
  approvalTimeoutSeconds: z.number().int().min(15).max(900).optional(),
  onTimeout: z.enum(vals(TimeoutAction)).optional(),
  allowPreApproved: z.boolean().optional(),
  requirePhoto: z.boolean().optional(),
  allowEmergencyEntry: z.boolean().optional(),
  overstayMinutes: z.number().int().min(15).max(1440).optional(),
});

export const adminSocietyUpdateBody = z.object({
  name: z.string().trim().min(2).max(200),
  address,
  contact,
  totalUnits: z.number().int().min(1).max(100000),
  logoFileId: objectId,
  settings: z.object({
    timezone: z.string().max(60).optional(),
    currency: z.string().length(3).optional(),
    rules: z.array(z.object({ title: z.string().min(1).max(200), body: z.string().min(1).max(5000) })).max(100).optional(),
    operatingHours: z.array(z.object({ day: z.enum(vals(Weekday)), open: hhmm.optional(), close: hhmm.optional(), closed: z.boolean().default(false) })).max(7).optional(),
    holidays: z.array(z.object({ date: z.iso.date(), name: z.string().min(1).max(120) })).max(100).optional(),
    visitorPolicy: visitorPolicy.optional(),
    finance: z.object({ dueDays: z.number().int().min(0).max(90).optional(), invoicePrefix: z.string().max(8).optional(), lateFee: z.object({ type: z.enum(vals(FeeType)).optional(), value: z.number().min(0).optional(), graceDays: z.number().int().min(0).max(60).optional() }).optional() }).optional(),
    listing: z.object({ expiryDays: z.number().int().min(1).max(365).optional(), autoPublish: z.boolean().optional(), reportSuspendThreshold: z.number().int().min(1).max(50).optional() }).optional(),
    complaint: z.object({ slaHours: z.object(Object.fromEntries(vals(Priority).map((k) => [k, z.number().int().min(1).max(720).optional()])) as any).optional() }).optional(),
    modules: featureFlags.optional(),
  }).optional(),
}).partial();

export const societyItem = globalEntity({
  name: z.string(),
  code: z.string(),
  type: z.enum(vals(SocietyType)),
  status: z.enum(vals(SocietyStatus)),
  organizationId: objectId.optional(),
  planId: objectId.optional(),
  address: address.optional(),
  contact: contact.optional(),
  totalUnits: z.number().int().optional(),
  features: z.record(z.string(), z.boolean()),
  settings: z.record(z.string(), z.any()),
  applicant: z.object({ name: z.string().optional(), email: z.string().optional(), mobile: z.string().optional() }).optional(),
});

export const impersonationBody = z.object({ reason: z.string().trim().min(10).max(500), durationMinutes: z.number().int().min(5).max(240).default(30) });
export const impersonationResponse = z.object({ accessToken: z.string(), tokenType: z.literal('Bearer'), expiresAt: dateTime, sessionId: objectId, societyId: objectId });

const nameBody = { name: z.string().trim().min(1).max(100) };
export const blockBody = z.object({ ...nameBody, description: z.string().max(300).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
export const towerBody = z.object({ ...nameBody, blockId: objectId.optional(), totalFloors: z.number().int().min(1).max(200).optional(), hasLift: z.boolean().optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional() });
export const floorBody = z.object({ towerId: objectId, number: z.number().int().min(-5).max(300), label: z.string().max(30).optional() });
export const flatBody = z.object({
  label: z.string().trim().min(1).max(40),
  towerId: objectId.optional(),
  blockId: objectId.optional(),
  floorId: objectId.optional(),
  floorNumber: z.number().int().optional(),
  unitNumber: z.string().trim().min(1).max(20),
  unitType: z.string().max(30).optional(),
  areaSqft: z.number().min(1).max(100000).optional(),
  status: z.enum(vals(FlatStatus)).optional(),
  parkingSlots: z.number().int().min(0).max(20).optional(),
});
export const gateBody = z.object({ ...nameBody, type: z.enum(['MAIN', 'SERVICE', 'VISITOR', 'DELIVERY', 'EMERGENCY']).optional(), location: z.string().max(200).optional(), shifts: z.array(z.enum(vals(Shift))).optional(), isActive: z.boolean().optional() });
export const bulkFlatsBody = z.object({
  towerId: objectId,
  fromFloor: z.number().int().min(0).max(200),
  toFloor: z.number().int().min(0).max(200),
  unitsPerFloor: z.number().int().min(1).max(50),
  unitType: z.string().max(30).optional(),
  areaSqft: z.number().min(1).optional(),
});
export const bulkFlatsResponse = z.object({ created: z.number().int(), skipped: z.number().int() });

export const blockQuery = listQuery;
export const towerQuery = listQuery.extend({ blockId: objectId.optional() });
export const floorQuery = listQuery.extend({ towerId: objectId.optional() });
export const flatQuery = listQuery.extend({ towerId: objectId.optional(), blockId: objectId.optional(), status: z.enum(vals(FlatStatus)).optional(), floorNumber: z.coerce.number().int().optional() });
export const gateQuery = listQuery;

export const blockItem = entity({ name: z.string(), description: z.string().optional(), status: z.string() });
export const towerItem = entity({ name: z.string(), blockId: objectId.optional(), totalFloors: z.number().optional(), hasLift: z.boolean(), status: z.string() });
export const floorItem = entity({ towerId: objectId, number: z.number(), label: z.string().optional() });
export const flatItem = entity({ label: z.string(), towerId: objectId.optional(), blockId: objectId.optional(), floorNumber: z.number().optional(), unitNumber: z.string(), unitType: z.string().optional(), areaSqft: z.number().optional(), status: z.enum(vals(FlatStatus)), parkingSlots: z.number() });
export const gateItem = entity({ name: z.string(), type: z.string(), location: z.string().optional(), shifts: z.array(z.string()).optional(), isActive: z.boolean() });
