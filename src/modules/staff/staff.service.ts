import { ApiError } from '../../common/utils/apiError';
import { createCrudService } from '../../common/services/crud.service';
import { oid } from '../../common/utils/objectId';
import { paginate } from '../../common/utils/pagination';
import { normalizeMobile } from '../auth/auth.service';
import { Complaint } from '../complaints/complaint.model';
import { Asset, Staff, StaffAttendance, Task, Vendor } from './staff.model';

export const staffService = createCrudService({ model: Staff, name: 'Staff member', searchFields: ['name', 'mobile', 'employeeCode'], filterable: ['staffType', 'status', 'verified', 'vendorId'], sortable: ['name', 'createdAt'] });
export const vendorService = createCrudService({ model: Vendor, name: 'Vendor', searchFields: ['name', 'category', 'contactPerson'], filterable: ['category', 'status', 'verified'], sortable: ['name', 'rating', 'createdAt'] });
export const taskService = createCrudService({ model: Task, name: 'Task', searchFields: ['title'], filterable: ['status', 'priority', 'assigneeId', 'assigneeType'], sortable: ['dueDate', 'createdAt', 'priority'] });
export const assetService = createCrudService({ model: Asset, name: 'Asset', searchFields: ['name', 'serialNo', 'category'], filterable: ['kind', 'status', 'category'], sortable: ['name', 'createdAt', 'nextServiceDate'] });

export const staffExtra = {
  normalize: (b: any) => ({ ...b, mobile: normalizeMobile(b.mobile) }),
  async verifyDocs(societyId: string, userId: string, id: string, body: { verified: boolean; documentTypes?: string[] }) {
    const s: any = await Staff.findOne({ _id: id, societyId });
    if (!s) throw ApiError.notFound('Staff member not found');
    if (body.documentTypes?.length) await Staff.updateOne({ _id: id, societyId }, { $set: { 'documents.$[d].verified': body.verified } }, { arrayFilters: [{ 'd.type': { $in: body.documentTypes } }] });
    const fresh: any = await Staff.findOne({ _id: id, societyId });
    const allVerified = fresh.documents.length > 0 && fresh.documents.every((d: any) => d.verified);
    return Staff.findOneAndUpdate({ _id: id, societyId }, { $set: { verified: body.documentTypes?.length ? allVerified : body.verified, updatedBy: userId } }, { new: true });
  },
  async markAttendance(societyId: string, userId: string, id: string, body: any) {
    if (!(await Staff.exists({ _id: id, societyId }))) throw ApiError.notFound('Staff member not found');
    return StaffAttendance.findOneAndUpdate({ societyId, staffId: id, date: body.date }, { $set: { ...body, markedBy: userId, updatedBy: userId }, $setOnInsert: { createdBy: userId } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  },
  async attendance(societyId: string, id: string, q: any) {
    const f: Record<string, any> = { societyId, staffId: id };
    if (q.from || q.to) f.date = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    return paginate(StaffAttendance, f, q, { sortable: ['date'], defaultSort: '-date' });
  },
  async performance(societyId: string, id: string, q: { from?: string; to?: string }) {
    const staff: any = await Staff.findOne({ _id: id, societyId });
    if (!staff) throw ApiError.notFound('Staff member not found');
    const sid = oid(societyId);
    const dateRange = q.from || q.to ? { date: { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) } } : {};
    const [att, tasks, cmp] = await Promise.all([
      StaffAttendance.aggregate([{ $match: { societyId: sid, staffId: oid(id), ...dateRange } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
      Task.aggregate([{ $match: { societyId: sid, assigneeType: 'STAFF', assigneeId: oid(id) } }, { $group: { _id: null, assigned: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } }, overdue: { $sum: { $cond: [{ $and: [{ $ne: ['$status', 'DONE'] }, { $lt: ['$dueDate', new Date()] }] }, 1, 0] } } } }]),
      Complaint.aggregate([{ $match: { societyId: sid, 'assignee.type': 'STAFF', 'assignee.refId': oid(id) } }, { $group: { _id: null, assigned: { $sum: 1 }, resolved: { $sum: { $cond: [{ $in: ['$status', ['RESOLVED', 'CLOSED']] }, 1, 0] } }, avgRating: { $avg: '$rating.score' } } }]),
    ]);
    const n = (s: string) => att.find((a: any) => a._id === s)?.n ?? 0;
    return { staffId: id, name: staff.name, attendance: { present: n('PRESENT') + n('HALF_DAY'), absent: n('ABSENT'), leave: n('LEAVE') }, tasks: { assigned: tasks[0]?.assigned ?? 0, done: tasks[0]?.done ?? 0, overdue: tasks[0]?.overdue ?? 0 }, complaints: { assigned: cmp[0]?.assigned ?? 0, resolved: cmp[0]?.resolved ?? 0, avgRating: cmp[0]?.avgRating ? Math.round(cmp[0].avgRating * 10) / 10 : null } };
  },
  async addContract(societyId: string, userId: string, id: string, body: any) {
    if (body.endDate < body.startDate) throw ApiError.badRequest('endDate must be after startDate');
    const v = await Vendor.findOneAndUpdate({ _id: id, societyId }, { $push: { contracts: body }, $set: { updatedBy: userId } }, { new: true });
    if (!v) throw ApiError.notFound('Vendor not found');
    return v;
  },
  async removeContract(societyId: string, userId: string, id: string, contractId: string) {
    const v = await Vendor.findOneAndUpdate({ _id: id, societyId }, { $pull: { contracts: { _id: contractId } }, $set: { updatedBy: userId } }, { new: true });
    if (!v) throw ApiError.notFound('Vendor not found');
    return v;
  },
  async updateTask(societyId: string, userId: string, id: string, body: any) {
    const set: Record<string, unknown> = { ...body, updatedBy: userId };
    if (body.status === 'DONE') set.completedAt = new Date();
    const t = await Task.findOneAndUpdate({ _id: id, societyId }, { $set: set }, { new: true, runValidators: true });
    if (!t) throw ApiError.notFound('Task not found');
    return t;
  },
  async lowStock(societyId: string) {
    const list: any[] = await Asset.find({ societyId, kind: 'INVENTORY', $expr: { $lte: ['$quantity', '$minQuantity'] } }).select('name quantity minQuantity').limit(200);
    return list.map((a) => ({ id: String(a._id), name: a.name, quantity: a.quantity, minQuantity: a.minQuantity }));
  },
};
