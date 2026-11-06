import { oid } from '../../common/utils/objectId';
import { ymd } from '../../common/utils/dates';
import { Complaint } from '../complaints/complaint.model';
import { Delivery } from '../delivery/delivery.model';
import { Guard } from '../guard/guard.model';
import { Invoice } from '../payments/payment.model';
import { Resident } from '../resident/resident.model';
import { Flat } from '../society/society.model';
import { Visitor } from '../visitors/visitor.model';

export const reportService = {
  async overview(societyId: string) {
    const [flats, occupied, residents, pendingResidents, guards, openComplaints, dues, visitorsToday] = await Promise.all([
      Flat.countDocuments({ societyId }),
      Flat.countDocuments({ societyId, status: 'OCCUPIED' }),
      Resident.countDocuments({ societyId, status: 'APPROVED' }),
      Resident.countDocuments({ societyId, status: 'PENDING' }),
      Guard.countDocuments({ societyId, status: 'ACTIVE' }),
      Complaint.countDocuments({ societyId, status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'REOPENED', 'ESCALATED'] } }),
      Invoice.aggregate([{ $match: { societyId: oid(societyId), status: { $in: ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'] } } }, { $group: { _id: null, total: { $sum: '$balance' } } }]),
      Visitor.countDocuments({ societyId, createdAt: { $gte: new Date(`${ymd()}T00:00:00.000Z`) } }),
    ]);
    return { flats, occupiedFlats: occupied, residents, pendingResidents, guards, openComplaints, outstandingDues: dues[0]?.total ?? 0, visitorsToday };
  },
  async visitors(societyId: string, q: { from?: string; to?: string }) {
    const match: Record<string, any> = { societyId: oid(societyId) };
    if (q.from || q.to) match.createdAt = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lte: new Date(`${q.to}T23:59:59.999Z`) } : {}) };
    const [byDay, byType, deliveries] = await Promise.all([
      Visitor.aggregate([{ $match: match }, { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, n: { $sum: 1 } } }, { $sort: { _id: 1 } }, { $limit: 366 }]),
      Visitor.aggregate([{ $match: match }, { $group: { _id: '$visitorType', n: { $sum: 1 } } }]),
      Delivery.countDocuments({ societyId, ...(match.createdAt ? { createdAt: match.createdAt } : {}) }),
    ]);
    return { perDay: byDay.map((d: any) => ({ date: d._id, count: d.n })), byType: Object.fromEntries(byType.map((t: any) => [t._id, t.n])), deliveries };
  },
};
