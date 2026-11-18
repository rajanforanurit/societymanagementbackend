import { PERMISSION_GRANTS_V2 } from '../../common/constants/permissions';
import { logger } from '../../common/utils/logger';
import { AppConfig } from '../super-admin/super-admin.model';
import { Role, RoleTemplate } from './roles.model';
import { ensureRoleTemplates } from './roles.service';

const MARKER = 'migration:role-permissions-v2';

/**
 * One-time, idempotent startup migration. Grants the V2 permissions (helpdesk, platform
 * monitoring, and security/guard/emergency for the Society Manager) to system roles that
 * already exist. Only ever ADDS permissions and records a marker, so later restarts never
 * re-grant something an admin removed.
 */
export async function syncSystemRoles() {
  try {
    await ensureRoleTemplates();
    if (await AppConfig.exists({ key: MARKER })) return;
    for (const [key, permissions] of Object.entries(PERMISSION_GRANTS_V2)) {
      await RoleTemplate.updateOne({ key }, { $addToSet: { permissions: { $each: permissions } } });
      await Role.updateMany({ key, isSystem: true }, { $addToSet: { permissions: { $each: permissions } } }).setOptions({ skipTenantCheck: true });
    }
    await AppConfig.create({ key: MARKER, value: { appliedAt: new Date().toISOString() }, description: 'System role permissions V2 granted' });
    logger.info('system_roles_synced');
  } catch (err) {
    logger.error('system_roles_sync_failed', { error: (err as Error).message });
  }
}
