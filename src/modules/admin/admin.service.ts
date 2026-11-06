import { ClientSession } from 'mongoose';
import { UserType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { hashPassword } from '../../common/utils/password';
import { normalizeMobile } from '../auth/auth.service';
import { User } from '../auth/auth.model';
import { Role } from '../roles/roles.model';
import { AdminProfile } from './admin.model';

export interface AdminInput {
  name: string;
  mobile: string;
  email?: string;
  password?: string;
  designation?: string;
}

export async function provisionAdmin(societyId: string, roleId: string, input: AdminInput, actorId: string | undefined, session?: ClientSession) {
  const role = await Role.findOne({ _id: roleId, societyId }).session(session ?? null);
  if (!role) throw ApiError.notFound('Role not found in this society');
  const mobile = normalizeMobile(input.mobile);
  let user: any = await User.findOne({ mobile }).session(session ?? null);
  if (user && user.userType !== UserType.SOCIETY_ADMIN) throw ApiError.conflict('This mobile number belongs to a non-admin account', 'MOBILE_EXISTS');
  if (!user) {
    if (!input.password) throw ApiError.badRequest('password is required for a new administrator', 'PASSWORD_REQUIRED');
    if (input.email && (await User.exists({ email: input.email.toLowerCase() }).session(session ?? null))) throw ApiError.conflict('Email is already registered', 'EMAIL_EXISTS');
    [user] = await User.create([{ name: input.name, mobile, email: input.email?.toLowerCase(), passwordHash: await hashPassword(input.password), userType: UserType.SOCIETY_ADMIN, isMobileVerified: true, mustChangePassword: true }], { session });
  }
  if (await AdminProfile.exists({ societyId, userId: user._id }).session(session ?? null)) throw ApiError.conflict('User is already an administrator of this society', 'ADMIN_EXISTS');
  const [profile] = await AdminProfile.create([{ societyId, userId: user._id, roleId, designation: input.designation, createdBy: actorId }], { session });
  return { user, profile };
}
