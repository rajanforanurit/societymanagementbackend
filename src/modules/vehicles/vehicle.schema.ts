import { z } from 'zod';
import { ParkingRequestStatus, ParkingStatus, VehicleType, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { listQuery, objectId } from '../../common/validators/common';

const plate = z.string().trim().toUpperCase().regex(/^[A-Z0-9 -]{4,15}$/, 'Invalid vehicle number');
export const vehicleBody = z.object({ flatId: objectId, number: plate, type: z.enum(vals(VehicleType)).default('CAR'), make: z.string().max(50).optional(), model: z.string().max(50).optional(), color: z.string().max(30).optional(), stickerNo: z.string().max(30).optional() });
export const vehicleItem = entity({ userId: objectId, flatId: objectId, number: z.string(), type: z.enum(vals(VehicleType)), make: z.string().optional(), model: z.string().optional(), color: z.string().optional(), stickerNo: z.string().optional(), parkingSlotId: objectId.optional(), status: z.string() });
export const vehicleQuery = listQuery.extend({ flatId: objectId.optional(), type: z.enum(vals(VehicleType)).optional() });
export const slotBody = z.object({ code: z.string().trim().min(1).max(20), level: z.string().max(20).optional(), type: z.enum(['CAR', 'BIKE', 'VISITOR']).default('CAR'), status: z.enum(vals(ParkingStatus)).default('AVAILABLE') });
export const slotItem = entity({ code: z.string(), level: z.string().optional(), type: z.string(), status: z.enum(vals(ParkingStatus)), flatId: objectId.optional(), vehicleId: objectId.optional() });
export const slotQuery = listQuery.extend({ status: z.enum(vals(ParkingStatus)).optional(), type: z.enum(['CAR', 'BIKE', 'VISITOR']).optional(), flatId: objectId.optional() });
export const allocateBody = z.object({ flatId: objectId, vehicleId: objectId.optional() });
export const requestBody = z.object({ vehicleId: objectId, preferredType: z.enum(['CAR', 'BIKE']).default('CAR') });
export const requestItem = entity({ userId: objectId, flatId: objectId, vehicleId: objectId, preferredType: z.string(), status: z.enum(vals(ParkingRequestStatus)), slotId: objectId.optional(), decisionNote: z.string().optional() });
export const requestQuery = listQuery.extend({ status: z.enum(vals(ParkingRequestStatus)).optional() });
export const decideBody = z.object({ decision: z.enum(['APPROVE', 'REJECT']), slotId: objectId.optional(), note: z.string().max(300).optional() });
