import { ParkingRequestStatus, ParkingStatus, VehicleType, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const Vehicle = defineModel(
  'Vehicle',
  makeSchema(
    {
      userId: refReq('User', { index: true }),
      flatId: refReq('Flat', { index: true }),
      number: { type: String, required: true, uppercase: true, trim: true },
      type: { type: String, enum: vals(VehicleType), default: 'CAR' },
      make: String,
      model: String,
      color: String,
      stickerNo: String,
      parkingSlotId: ref('ParkingSlot'),
      status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    },
    { indexes: [[{ societyId: 1, number: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);

export const ParkingSlot = defineModel(
  'ParkingSlot',
  makeSchema(
    {
      code: { type: String, required: true, trim: true },
      level: String,
      type: { type: String, enum: ['CAR', 'BIKE', 'VISITOR'], default: 'CAR' },
      status: { type: String, enum: vals(ParkingStatus), default: 'AVAILABLE', index: true },
      flatId: ref('Flat', { index: true }),
      vehicleId: ref('Vehicle'),
    },
    { indexes: [[{ societyId: 1, code: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);

export const ParkingRequest = defineModel(
  'ParkingRequest',
  makeSchema(
    {
      userId: refReq('User', { index: true }),
      flatId: refReq('Flat'),
      vehicleId: refReq('Vehicle'),
      preferredType: { type: String, enum: ['CAR', 'BIKE'], default: 'CAR' },
      status: { type: String, enum: vals(ParkingRequestStatus), default: 'PENDING', index: true },
      slotId: ref('ParkingSlot'),
      decisionNote: String,
      decidedBy: ref('User'),
    },
    { indexes: [[{ societyId: 1, status: 1, createdAt: -1 }]] },
  ),
);
