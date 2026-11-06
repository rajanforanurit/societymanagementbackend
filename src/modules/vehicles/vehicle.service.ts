import { ApiError } from '../../common/utils/apiError';
import { createCrudService } from '../../common/services/crud.service';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { withTransaction } from '../../common/utils/transaction';
import { notifyUsers } from '../notifications/notify.service';
import { ParkingRequest, ParkingSlot, Vehicle } from './vehicle.model';

export const vehicleService = createCrudService({ model: Vehicle, name: 'Vehicle', searchFields: ['number', 'make', 'model'], filterable: ['flatId', 'type'], sortable: ['number', 'createdAt'] });
export const slotService = createCrudService({
  model: ParkingSlot,
  name: 'Parking slot',
  searchFields: ['code'],
  filterable: ['status', 'type', 'flatId'],
  sortable: ['code', 'createdAt'],
  defaultSort: 'code',
  beforeRemove: async (societyId, id) => {
    if (await ParkingSlot.exists({ _id: id, societyId, status: 'ALLOCATED' })) throw ApiError.conflict('Release the slot before deleting it', 'SLOT_ALLOCATED');
  },
});

export const parkingService = {
  async allocate(societyId: string, actorId: string, slotId: string, body: { flatId: string; vehicleId?: string }) {
    return withTransaction(async (session) => {
      const slot: any = await ParkingSlot.findOneAndUpdate({ _id: slotId, societyId, status: 'AVAILABLE' }, { $set: { status: 'ALLOCATED', flatId: body.flatId, vehicleId: body.vehicleId, updatedBy: actorId } }, { new: true, session });
      if (!slot) throw ApiError.conflict('Slot is not available', 'SLOT_UNAVAILABLE');
      if (body.vehicleId) {
        const v = await Vehicle.findOneAndUpdate({ _id: body.vehicleId, societyId, flatId: body.flatId }, { $set: { parkingSlotId: slotId } }, { session });
        if (!v) throw ApiError.notFound('Vehicle not found for this flat');
      }
      return slot;
    });
  },
  async release(societyId: string, actorId: string, slotId: string) {
    const slot: any = await ParkingSlot.findOneAndUpdate({ _id: slotId, societyId, status: 'ALLOCATED' }, { $set: { status: 'AVAILABLE', updatedBy: actorId }, $unset: { flatId: 1, vehicleId: 1 } }, { new: false });
    if (!slot) throw ApiError.conflict('Slot is not allocated', 'INVALID_STATE');
    if (slot.vehicleId) await Vehicle.updateOne({ _id: slot.vehicleId, societyId }, { $unset: { parkingSlotId: 1 } });
    return ParkingSlot.findOne({ _id: slotId, societyId });
  },
  async request(societyId: string, userId: string, flatIds: string[], body: any) {
    const v: any = await Vehicle.findOne({ _id: body.vehicleId, societyId, userId, flatId: { $in: flatIds } });
    if (!v) throw ApiError.notFound('Vehicle not found');
    if (v.parkingSlotId) throw ApiError.conflict('Vehicle already has a parking slot', 'ALREADY_ALLOCATED');
    if (await ParkingRequest.exists({ societyId, vehicleId: v._id, status: 'PENDING' })) throw ApiError.conflict('A request is already pending', 'REQUEST_EXISTS');
    return ParkingRequest.create({ societyId, userId, flatId: v.flatId, vehicleId: v._id, preferredType: body.preferredType, createdBy: userId });
  },
  async listRequests(societyId: string, q: any, scope: Record<string, unknown> = {}) {
    return paginate(ParkingRequest, applyListFilters({ societyId, ...scope, ...(q.status ? { status: q.status } : {}) }, q), q, { sortable: ['createdAt'] });
  },
  async decide(societyId: string, actorId: string, id: string, body: any) {
    const r: any = await ParkingRequest.findOne({ _id: id, societyId, status: 'PENDING' });
    if (!r) throw ApiError.conflict('Request not found or already decided', 'INVALID_STATE');
    if (body.decision === 'APPROVE') {
      if (!body.slotId) throw ApiError.badRequest('slotId is required to approve', 'SLOT_REQUIRED');
      await parkingService.allocate(societyId, actorId, body.slotId, { flatId: String(r.flatId), vehicleId: String(r.vehicleId) });
    }
    const upd = await ParkingRequest.findOneAndUpdate({ _id: id, societyId, status: 'PENDING' }, { $set: { status: body.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', slotId: body.slotId, decisionNote: body.note, decidedBy: actorId } }, { new: true });
    await notifyUsers({ societyId, userIds: [r.userId], type: 'APPROVAL', title: `Parking request ${body.decision === 'APPROVE' ? 'approved' : 'rejected'}`, body: body.note ?? '', data: { requestId: id } });
    return upd;
  },
  async cancelRequest(societyId: string, userId: string, id: string) {
    const r = await ParkingRequest.findOneAndUpdate({ _id: id, societyId, userId, status: 'PENDING' }, { $set: { status: 'CANCELLED' } }, { new: true });
    if (!r) throw ApiError.notFound('Pending request not found');
    return r;
  },
};
