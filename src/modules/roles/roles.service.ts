import { ClientSession } from 'mongoose';
import { SYSTEM_ROLE_TEMPLATES, computePermissions } from '../../common/constants/permissions';
import { ApiError } from '../../common/utils/apiError';
import { createCrudService } from '../../common/services/crud.service';
import { AdminProfile } from '../admin/admin.model';
import { Role, RoleTemplate } from './roles.model';

export const roleService = createCrudService({
  model: Role,
  name: 'Role',
  searchFields: ['name', 'key'],
  filterable: ['isSystem'],
  sortable: ['name', 'createdAt'],
  defaultSort: 'name',
  beforeRemove: async (societyId, id) => {
    const role: any = await Role.findOne({ _id: id, societyId });
    if (!role) throw ApiError.notFound('Role not found');
    if (role.isSystem) throw ApiError.conflict('System roles cannot be deleted', 'SYSTEM_ROLE');
    if (await AdminProfile.exists({ roleId: id, societyId })) throw ApiError.conflict('Role is assigned to administrators', 'ROLE_IN_USE');
  },
});

export const globalRoleService = createCrudService({ model: RoleTemplate, name: 'Role template', searchFields: ['name', 'key'], sortable: ['name', 'createdAt'] });

export async function ensureRoleTemplates() {
  const count = await RoleTemplate.countDocuments({});
  if (count > 0) return;
  await RoleTemplate.insertMany(SYSTEM_ROLE_TEMPLATES.map((t) => ({ ...t })));
}

export async function seedSocietyRoles(societyId: string, actorId: string | undefined, session?: ClientSession) {
  await ensureRoleTemplates();
  const templates: any[] = await RoleTemplate.find({ isActive: true });
  const docs = templates.map((t) => ({ societyId, key: t.key, name: t.name, description: t.description, permissions: t.permissions, isSystem: true, createdBy: actorId }));
  const created = await Role.create(docs, { session, ordered: true });
  return created as any[];
}

export async function adminUserIdsWith(societyId: string, permission?: string) {
  const profiles: any[] = await AdminProfile.find({ societyId, status: 'ACTIVE' }).populate('roleId', 'permissions');
  return profiles
    .filter((p) => !permission || computePermissions(p.roleId?.permissions, p.extraPermissions, p.revokedPermissions).has(permission))
    .map((p) => String(p.userId));
}
