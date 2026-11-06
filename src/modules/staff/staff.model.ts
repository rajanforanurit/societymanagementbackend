import { Schema } from 'mongoose';
import { AssetStatus, AttendanceStatus, ContractStatus, Priority, StaffType, TaskStatus, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const Staff = defineModel(
  'Staff',
  makeSchema(
    {
      name: { type: String, required: true, trim: true },
      mobile: { type: String, required: true },
      staffType: { type: String, enum: vals(StaffType), required: true, index: true },
      employeeCode: String,
      vendorId: ref('Vendor'),
      salaryMonthly: Number,
      joinedAt: Date,
      photoFileId: ref('File'),
      documents: [{ type: { type: String, required: true }, fileId: refReq('File'), verified: { type: Boolean, default: false } }],
      verified: { type: Boolean, default: false },
      status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE', index: true },
    },
    { indexes: [[{ societyId: 1, mobile: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } }]] },
  ),
);

export const StaffAttendance = defineModel(
  'StaffAttendance',
  makeSchema(
    { staffId: refReq('Staff', { index: true }), date: { type: String, required: true }, status: { type: String, enum: vals(AttendanceStatus), required: true }, checkIn: Date, checkOut: Date, note: String, markedBy: ref('User') },
    { indexes: [[{ societyId: 1, staffId: 1, date: 1 }, { unique: true }], [{ societyId: 1, date: 1 }]] },
  ),
);

export const Vendor = defineModel(
  'Vendor',
  makeSchema(
    {
      name: { type: String, required: true, trim: true },
      category: { type: String, required: true },
      contactPerson: String,
      mobile: { type: String, required: true },
      email: String,
      gstin: String,
      verified: { type: Boolean, default: false },
      status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
      rating: { type: Number, default: 0 },
      contracts: [{ title: { type: String, required: true }, startDate: { type: String, required: true }, endDate: { type: String, required: true }, amount: Number, fileId: ref('File'), status: { type: String, enum: vals(ContractStatus), default: 'ACTIVE' } }],
    },
    { indexes: [[{ societyId: 1, category: 1 }]] },
  ),
);

export const Task = defineModel(
  'Task',
  makeSchema(
    {
      title: { type: String, required: true, trim: true },
      description: String,
      assigneeType: { type: String, enum: ['STAFF', 'ADMIN', 'VENDOR'], required: true },
      assigneeId: { type: Schema.Types.ObjectId, required: true, index: true },
      priority: { type: String, enum: vals(Priority), default: 'MEDIUM' },
      status: { type: String, enum: vals(TaskStatus), default: 'TODO', index: true },
      dueDate: Date,
      completedAt: Date,
      complaintId: ref('Complaint'),
    },
    { indexes: [[{ societyId: 1, status: 1, dueDate: 1 }]] },
  ),
);

export const Asset = defineModel(
  'Asset',
  makeSchema(
    {
      name: { type: String, required: true, trim: true },
      kind: { type: String, enum: ['ASSET', 'INVENTORY'], default: 'ASSET' },
      category: String,
      serialNo: String,
      location: String,
      purchaseDate: String,
      cost: Number,
      warrantyUntil: String,
      quantity: { type: Number, default: 1 },
      minQuantity: { type: Number, default: 0 },
      vendorId: ref('Vendor'),
      nextServiceDate: String,
      status: { type: String, enum: vals(AssetStatus), default: 'IN_USE', index: true },
    },
    { indexes: [[{ societyId: 1, kind: 1, status: 1 }]] },
  ),
);
