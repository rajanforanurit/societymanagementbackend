export const Permission = {
  SOCIETY_READ: 'society:read',
  SOCIETY_UPDATE: 'society:update',
  STRUCTURE_MANAGE: 'structure:manage',
  ROLE_MANAGE: 'role:manage',
  ADMIN_MANAGE: 'admin:manage',
  GUARD_MANAGE: 'guard:manage',
  RESIDENT_READ: 'resident:read',
  RESIDENT_MANAGE: 'resident:manage',
  RESIDENT_APPROVE: 'resident:approve',
  APPROVAL_REVIEW: 'approval:review',
  LISTING_MANAGE: 'listing:manage',
  VISITOR_READ: 'visitor:read',
  VISITOR_POLICY: 'visitor:policy',
  SECURITY_MANAGE: 'security:manage',
  EMERGENCY_MANAGE: 'emergency:manage',
  COMPLAINT_READ: 'complaint:read',
  COMPLAINT_MANAGE: 'complaint:manage',
  NOTICE_MANAGE: 'notice:manage',
  POLL_MANAGE: 'poll:manage',
  DOCUMENT_MANAGE: 'document:manage',
  AMENITY_MANAGE: 'amenity:manage',
  BOOKING_MANAGE: 'booking:manage',
  FINANCE_READ: 'finance:read',
  FINANCE_MANAGE: 'finance:manage',
  EXPENSE_MANAGE: 'expense:manage',
  STAFF_MANAGE: 'staff:manage',
  VENDOR_MANAGE: 'vendor:manage',
  DOMESTIC_HELP_MANAGE: 'domestic-help:manage',
  VEHICLE_MANAGE: 'vehicle:manage',
  PARKING_MANAGE: 'parking:manage',
  ASSET_MANAGE: 'asset:manage',
  TASK_MANAGE: 'task:manage',
  REPORT_READ: 'report:read',
  AUDIT_READ: 'audit:read',
  SUPPORT_MANAGE: 'support:manage',
} as const;

export type PermissionKey = (typeof Permission)[keyof typeof Permission];
export const ALL_PERMISSIONS = Object.values(Permission) as PermissionKey[];
const P = Permission;

export interface RoleTemplateDef {
  key: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
}

export const SYSTEM_ROLE_TEMPLATES: RoleTemplateDef[] = [
  { key: 'COMMUNITY_ADMIN', name: 'Community Admin', description: 'Full administrative access to the society', permissions: ALL_PERMISSIONS },
  {
    key: 'SOCIETY_MANAGER',
    name: 'Society Manager',
    description: 'Day-to-day society operations',
    permissions: [P.SOCIETY_READ, P.SOCIETY_UPDATE, P.STRUCTURE_MANAGE, P.RESIDENT_READ, P.RESIDENT_MANAGE, P.RESIDENT_APPROVE, P.APPROVAL_REVIEW, P.LISTING_MANAGE, P.NOTICE_MANAGE, P.POLL_MANAGE, P.DOCUMENT_MANAGE, P.AMENITY_MANAGE, P.BOOKING_MANAGE, P.STAFF_MANAGE, P.VENDOR_MANAGE, P.TASK_MANAGE, P.VISITOR_READ, P.COMPLAINT_READ, P.REPORT_READ, P.DOMESTIC_HELP_MANAGE, P.SUPPORT_MANAGE],
  },
  {
    key: 'SECURITY_ADMIN',
    name: 'Security Admin',
    description: 'Gates, guards, visitors and emergencies',
    permissions: [P.SOCIETY_READ, P.GUARD_MANAGE, P.VISITOR_READ, P.VISITOR_POLICY, P.SECURITY_MANAGE, P.EMERGENCY_MANAGE, P.DOMESTIC_HELP_MANAGE, P.STRUCTURE_MANAGE],
  },
  {
    key: 'HELPDESK_MANAGER',
    name: 'Helpdesk Manager',
    description: 'Complaint handling and resident communication',
    permissions: [P.SOCIETY_READ, P.COMPLAINT_READ, P.COMPLAINT_MANAGE, P.NOTICE_MANAGE, P.RESIDENT_READ, P.TASK_MANAGE, P.REPORT_READ],
  },
  {
    key: 'ACCOUNTANT',
    name: 'Accountant / Treasurer',
    description: 'Billing, payments, expenses and financial reports',
    permissions: [P.SOCIETY_READ, P.FINANCE_READ, P.FINANCE_MANAGE, P.EXPENSE_MANAGE, P.VENDOR_MANAGE, P.REPORT_READ, P.RESIDENT_READ],
  },
  {
    key: 'FACILITY_MANAGER',
    name: 'Facility Manager',
    description: 'Amenities, assets, parking and facility staff',
    permissions: [P.SOCIETY_READ, P.AMENITY_MANAGE, P.BOOKING_MANAGE, P.ASSET_MANAGE, P.VEHICLE_MANAGE, P.PARKING_MANAGE, P.STAFF_MANAGE, P.TASK_MANAGE, P.VENDOR_MANAGE],
  },
  {
    key: 'MAINTENANCE_MANAGER',
    name: 'Maintenance Manager',
    description: 'Maintenance staff, vendors and repair complaints',
    permissions: [P.SOCIETY_READ, P.COMPLAINT_READ, P.COMPLAINT_MANAGE, P.STAFF_MANAGE, P.ASSET_MANAGE, P.TASK_MANAGE, P.VENDOR_MANAGE],
  },
  { key: 'CUSTOM', name: 'Custom Admin', description: 'Permissions configured individually', permissions: [P.SOCIETY_READ] },
];

export const computePermissions = (rolePerms: string[] = [], extra: string[] = [], revoked: string[] = []) => {
  const valid = new Set<string>(ALL_PERMISSIONS);
  const set = new Set([...rolePerms, ...extra].filter((p) => valid.has(p)));
  revoked.forEach((p) => set.delete(p));
  return set;
};
