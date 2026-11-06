export const vals = <T extends Record<string, string>>(o: T) => Object.values(o) as [T[keyof T], ...T[keyof T][]];

const e = <const T extends readonly string[]>(...keys: T) =>
  Object.fromEntries(keys.map((k) => [k, k])) as { [K in T[number]]: K };

export const UserType = e('SUPER_ADMIN', 'SOCIETY_ADMIN', 'GUARD', 'RESIDENT');
export type UserType = (typeof UserType)[keyof typeof UserType];

export const SocietyStatus = e('PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED');
export const SocietyType = e('APARTMENT', 'GATED_COMMUNITY', 'TOWNSHIP', 'VILLA_COMMUNITY', 'COMMERCIAL_COMPLEX');
export const ProfileStatus = e('ACTIVE', 'INACTIVE', 'SUSPENDED');
export const ResidentStatus = e('PENDING', 'APPROVED', 'REJECTED', 'INACTIVE', 'MOVED_OUT');
export const ResidentType = e('OWNER', 'TENANT', 'FAMILY_MEMBER', 'AUTHORIZED_OCCUPANT');
export const FlatStatus = e('VACANT', 'OCCUPIED', 'BLOCKED');
export const Weekday = e('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');
export const Shift = e('MORNING', 'AFTERNOON', 'NIGHT', 'GENERAL');

export const ApprovalStatus = e('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED', 'PUBLISHED', 'EXPIRED', 'SUSPENDED', 'REMOVED');
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];
export const ApprovalEntityType = e('MARKETPLACE_LISTING', 'PROPERTY_LISTING', 'COMMUNITY_POST', 'MOVE_REQUEST');
export type ApprovalEntityType = (typeof ApprovalEntityType)[keyof typeof ApprovalEntityType];

export const MarketplaceListingType = e('PRODUCT', 'SECOND_HAND_FURNITURE', 'SECOND_HAND_ELECTRONICS', 'LOCAL_BUSINESS', 'HOME_BUSINESS', 'PROFESSIONAL_SERVICE', 'COMMUNITY_ANNOUNCEMENT');
export const PropertyListingType = e('FOR_SALE', 'FOR_RENT', 'PAYING_GUEST', 'SHARED_ACCOMMODATION', 'COMMERCIAL', 'VACANT_SPACE_LEASE');
export const ItemCondition = e('NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR');
export const Furnishing = e('UNFURNISHED', 'SEMI_FURNISHED', 'FURNISHED');
export const ReportStatus = e('OPEN', 'REVIEWED', 'DISMISSED');
export const InquiryStatus = e('NEW', 'CONTACTED', 'CLOSED');
export const MoveType = e('MOVE_IN', 'MOVE_OUT');

export const VisitorType = e('GUEST', 'SERVICE_PROVIDER', 'GIG_WORKER', 'CAB_DRIVER', 'OTHER');
export const VisitorStatus = e('EXPECTED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CHECKED_IN', 'CHECKED_OUT', 'DENIED', 'CANCELLED', 'EXPIRED');
export const ApprovalMode = e('RESIDENT', 'PRE_APPROVED', 'POLICY_AUTO', 'TIMEOUT_ALLOWED', 'EMERGENCY');
export const InvitationStatus = e('ACTIVE', 'CANCELLED', 'EXPIRED', 'EXHAUSTED');
export const DeliveryType = e('FOOD', 'GROCERY', 'PARCEL', 'COURIER', 'MEDICINE', 'OTHER');
export const DeliveryStatus = e('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'ENTERED', 'EXITED', 'LEFT_AT_GATE', 'COLLECTED');
export const TimeoutAction = e('DENY', 'ALLOW', 'ESCALATE');

export const DomesticHelpType = e('MAID', 'COOK', 'DRIVER', 'CLEANER', 'NANNY', 'GARDENER', 'OTHER');
export const DomesticHelpStatus = e('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED', 'SUSPENDED');
export const AttendanceStatus = e('PRESENT', 'ABSENT', 'LEAVE', 'HALF_DAY');
export const HelpPaymentType = e('SALARY', 'ADVANCE', 'BONUS', 'DEDUCTION');
export const ServiceCategory = e('ELECTRICIAN', 'PLUMBER', 'CARPENTER', 'PAINTER', 'PEST_CONTROL', 'APPLIANCE_REPAIR', 'CLEANING', 'MOVERS', 'OTHER');

export const ComplaintCategory = e('WATER', 'ELECTRICITY', 'LIFT', 'CLEANLINESS', 'SECURITY', 'PLUMBING', 'PARKING', 'NOISE', 'GARDEN', 'OTHER');
export const ComplaintStatus = e('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED', 'ESCALATED');
export const Priority = e('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
export const AssigneeType = e('STAFF', 'VENDOR', 'ADMIN');

export const NoticeType = e('ANNOUNCEMENT', 'EMERGENCY', 'CIRCULAR', 'EVENT');
export const PublishStatus = e('DRAFT', 'PUBLISHED', 'ARCHIVED');
export const PollKind = e('POLL', 'SURVEY', 'ELECTION');
export const PollStatus = e('DRAFT', 'ACTIVE', 'CLOSED');
export const QuestionType = e('SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'TEXT');

export const AmenityType = e('GYM', 'CLUBHOUSE', 'SWIMMING_POOL', 'SPORTS_COURT', 'PARTY_HALL', 'GARDEN', 'OTHER');
export const BookingStatus = e('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

export const ChargeType = e('MAINTENANCE', 'ELECTRICITY', 'WATER', 'PARKING', 'SINKING_FUND', 'AMENITY', 'PENALTY', 'OTHER');
export const CalcMethod = e('FIXED', 'PER_SQFT');
export const Frequency = e('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY');
export const InvoiceStatus = e('UNPAID', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');
export const PaymentStatus = e('INITIATED', 'PENDING_VERIFICATION', 'SUCCESS', 'FAILED', 'REFUNDED');
export const PaymentMethod = e('ONLINE', 'UPI', 'CARD', 'NET_BANKING', 'CASH', 'CHEQUE', 'BANK_TRANSFER');
export const ExpenseCategory = e('SALARY', 'UTILITIES', 'REPAIRS', 'SECURITY', 'HOUSEKEEPING', 'GARDENING', 'EVENTS', 'INSURANCE', 'TAXES', 'OTHER');
export const FeeType = e('FIXED', 'PERCENT');

export const VehicleType = e('CAR', 'BIKE', 'SCOOTER', 'BICYCLE', 'OTHER');
export const ParkingStatus = e('AVAILABLE', 'ALLOCATED', 'BLOCKED');
export const ParkingRequestStatus = e('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
export const DocumentCategory = e('BYLAWS', 'MINUTES', 'POLICY', 'CIRCULAR', 'FINANCIAL', 'LEGAL', 'FLAT_DOCUMENT', 'PERSONAL', 'OTHER');
export const DocumentScope = e('SOCIETY', 'FLAT', 'PERSONAL');
export const FilePurpose = e('PROFILE', 'VERIFICATION', 'LISTING', 'COMPLAINT', 'DOCUMENT', 'VISITOR', 'STAFF', 'INVOICE', 'OTHER');

export const EmergencyType = e('PANIC', 'FIRE', 'MEDICAL', 'SECURITY', 'OTHER');
export const AlertStatus = e('ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM');
export const IncidentType = e('SUSPICIOUS_ACTIVITY', 'THEFT', 'ALTERCATION', 'TRESPASS', 'DAMAGE', 'OTHER');
export const IncidentStatus = e('OPEN', 'INVESTIGATING', 'CLOSED');
export const LostFoundType = e('LOST', 'FOUND');
export const LostFoundStatus = e('OPEN', 'CLAIMED', 'CLOSED');

export const NotificationType = e('VISITOR', 'DELIVERY', 'PAYMENT', 'COMPLAINT', 'MARKETPLACE', 'ANNOUNCEMENT', 'BOOKING', 'EMERGENCY', 'APPROVAL', 'CHAT', 'SYSTEM');
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const StaffType = e('HOUSEKEEPING', 'MAINTENANCE', 'ELECTRICIAN', 'PLUMBER', 'GARDENER', 'SECURITY', 'OTHER');
export const TaskStatus = e('TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED');
export const AssetStatus = e('IN_USE', 'UNDER_MAINTENANCE', 'RETIRED', 'IN_STOCK');
export const ContractStatus = e('ACTIVE', 'EXPIRED', 'TERMINATED');

export const TicketCategory = e('BUG', 'ACCESS', 'BILLING', 'FEATURE_REQUEST', 'DATA', 'OTHER');
export const TicketStatus = e('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
export const OtpPurpose = e('REGISTER', 'LOGIN', 'RESET_PASSWORD');
export const Severity = e('INFO', 'WARNING', 'CRITICAL');
export const Audience = e('ALL', 'ADMINS', 'RESIDENTS', 'GUARDS');
export const ConversationContext = e('DIRECT', 'MARKETPLACE_LISTING', 'PROPERTY_LISTING');
export const BillingCycle = e('MONTHLY', 'QUARTERLY', 'YEARLY');

export const FEATURE_KEYS = [
  'marketplace',
  'property',
  'visitors',
  'delivery',
  'domesticHelp',
  'complaints',
  'amenities',
  'payments',
  'community',
  'polls',
  'vehicles',
  'documents',
  'chat',
  'emergency',
  'staff',
  'assets',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
