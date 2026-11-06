import { UserType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { hashPassword } from '../../common/utils/password';
import { withTransaction } from '../../common/utils/transaction';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { User } from '../auth/auth.model';
import { normalizeMobile } from '../auth/auth.service';
import { Gate } from '../society/society.model';
import { Guard } from './guard.model';

const populateUser = { path: 'userId', select: 'name mobile lastLoginAt' };
const shape = (g: any) => {
  const j = g.toJSON();
  if (j.userId && typeof j.userId === 'object') {
    j.user = j.userId;
    j.userId = j.user.id;
  }
  return j;
};

export const guardMgmt = {
  async list(societyId: string, query: any) {
    const filter: Record<string, unknown> = { societyId };
    ['gateId', 'status', 'shift'].forEach((k) => query[k] && (filter[k] = query[k]));
    const r = await paginate(Guard, applyListFilters(filter, query), query, { populate: populateUser });
    return { ...r, items: r.items.map(shape) };
  },
  async get(societyId: string, id: string) {
    const g = await Guard.findOne({ _id: id, societyId }).populate(populateUser);
    if (!g) throw ApiError.notFound('Guard not found');
    return shape(g);
  },
  async create(societyId: string, actorId: string, input: any) {
    if (!(await Gate.exists({ _id: input.gateId, societyId }))) throw ApiError.notFound('Gate not found');
    const mobile = normalizeMobile(input.mobile);
    return withTransaction(async (session) => {
      if (await User.exists({ mobile }).session(session ?? null)) throw ApiError.conflict('Mobile number is already registered', 'MOBILE_EXISTS');
      const [user]: any[] = await User.create([{ name: input.name, mobile, email: input.email?.toLowerCase(), passwordHash: await hashPassword(input.password), userType: UserType.GUARD, isMobileVerified: true, mustChangePassword: true }], { session });
      const [guard]: any[] = await Guard.create([{ societyId, userId: user._id, gateId: input.gateId, employeeCode: input.employeeCode, agency: input.agency, shift: input.shift, joinedAt: new Date(), createdBy: actorId }], { session });
      return shape(await guard.populate(populateUser));
    });
  },
  async update(societyId: string, id: string, actorId: string, body: any) {
    if (body.gateId && !(await Gate.exists({ _id: body.gateId, societyId }))) throw ApiError.notFound('Gate not found');
    const g = await Guard.findOneAndUpdate({ _id: id, societyId }, { $set: { ...body, updatedBy: actorId } }, { new: true, runValidators: true });
    if (!g) throw ApiError.notFound('Guard not found');
    return shape(await g.populate(populateUser));
  },
  async remove(societyId: string, id: string, actorId: string) {
    const g = await Guard.findOneAndUpdate({ _id: id, societyId }, { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: actorId, status: 'INACTIVE' } });
    if (!g) throw ApiError.notFound('Guard not found');
    await User.updateOne({ _id: g.userId }, { $inc: { tokenVersion: 1 } });
  },
};
