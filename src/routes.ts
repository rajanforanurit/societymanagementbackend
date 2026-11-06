import { ModuleRouter } from './common/openapi/router';
import { adminAuditRouter, superAuditRouter } from './modules/audit/audit.routes';
import { authRouter } from './modules/auth/auth.routes';
import { adminMgmtRouter, superAdminMgmtRouter } from './modules/admin/admin.routes';
import { amenityAdminRouter, amenityResidentRouter } from './modules/amenities/amenity.routes';
import { approvalRouter } from './modules/approvals/approval.routes';
import { chatRouter } from './modules/chat/chat.routes';
import { communityAdminRouter, communityResidentRouter, pollResidentRouter } from './modules/community/community.routes';
import { complaintAdminRouter, complaintResidentRouter } from './modules/complaints/complaint.routes';
import { documentAdminRouter, documentResidentRouter } from './modules/documents/document.routes';
import { domesticAdminRouter, domesticResidentRouter } from './modules/domestic-help/domestic.routes';
import { emergencyAdminRouter, emergencyResidentRouter, personalContactRouter } from './modules/emergency/emergency.routes';
import { filesRouter } from './modules/files/files.routes';
import { guardMgmtRouter } from './modules/guard/guard.mgmt.routes';
import { guardRouter } from './modules/guard/guard.routes';
import { marketplaceAdminRouter, marketplaceResidentRouter } from './modules/marketplace/marketplace.routes';
import { notificationRouter } from './modules/notifications/notification.routes';
import { financeAdminRouter, paymentResidentRouter, paymentWebhookRouter } from './modules/payments/payment.routes';
import { propertyAdminRouter, propertyResidentRouter } from './modules/property/property.routes';
import { reportRouter } from './modules/reports/report.routes';
import { familyRouter, moveAdminRouter, moveSelfRouter, residentAdminRouter, residentSelfRouter } from './modules/resident/resident.routes';
import { rolesRouter, globalRolesRouter } from './modules/roles/roles.routes';
import { adminStructureRouter, impersonationRouter, societyPublicRouter, superSocietyRouter } from './modules/society/society.routes';
import { staffAdminRouter } from './modules/staff/staff.routes';
import { adminSupportRouter, announcementReadRouter, superDashboardRouter, superPlatformRouter, superSecurityRouter, superSupportRouter } from './modules/super-admin/super-admin.routes';
import { vehicleAdminRouter, vehicleResidentRouter } from './modules/vehicles/vehicle.routes';
import { adminVisitorRouter, residentVisitorRouter } from './modules/visitors/visitor.routes';

export const allRouters: ModuleRouter[] = [
  authRouter,
  societyPublicRouter,
  notificationRouter,
  announcementReadRouter,
  filesRouter,
  paymentWebhookRouter,
  superDashboardRouter,
  superSocietyRouter,
  impersonationRouter,
  superAdminMgmtRouter,
  superPlatformRouter,
  globalRolesRouter,
  superSecurityRouter,
  superAuditRouter,
  superSupportRouter,
  adminStructureRouter,
  rolesRouter,
  adminMgmtRouter,
  guardMgmtRouter,
  residentAdminRouter,
  moveAdminRouter,
  approvalRouter,
  marketplaceAdminRouter,
  propertyAdminRouter,
  adminVisitorRouter,
  emergencyAdminRouter,
  complaintAdminRouter,
  communityAdminRouter,
  amenityAdminRouter,
  financeAdminRouter,
  staffAdminRouter,
  domesticAdminRouter,
  vehicleAdminRouter,
  documentAdminRouter,
  reportRouter,
  adminAuditRouter,
  adminSupportRouter,
  guardRouter,
  residentSelfRouter,
  familyRouter,
  moveSelfRouter,
  residentVisitorRouter,
  marketplaceResidentRouter,
  propertyResidentRouter,
  chatRouter,
  communityResidentRouter,
  pollResidentRouter,
  complaintResidentRouter,
  amenityResidentRouter,
  paymentResidentRouter,
  domesticResidentRouter,
  vehicleResidentRouter,
  emergencyResidentRouter,
  personalContactRouter,
  documentResidentRouter,
];
