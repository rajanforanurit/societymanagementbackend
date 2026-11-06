import { z } from 'zod';
import { AssetStatus, AttendanceStatus, ContractStatus, Priority, StaffType, TaskStatus, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateOnly, dateTime, email, listQuery, mobile, money, objectId } from '../../common/validators/common';

const doc = z.object({ type: z.string().min(2).max(40), fileId: objectId, verified: z.boolean().default(false) });
export const staffBody = z.object({ name: z.string().trim().min(2).max(120), mobile, staffType: z.enum(vals(StaffType)), employeeCode: z.string().max(30).optional(), vendorId: objectId.optional(), salaryMonthly: money.optional(), joinedAt: dateOnly.optional(), photoFileId: objectId.optional(), documents: z.array(doc).max(10).default([]), status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE') });
export const staffItem = entity({ name: z.string(), mobile: z.string(), staffType: z.enum(vals(StaffType)), employeeCode: z.string().optional(), vendorId: objectId.optional(), verified: z.boolean(), status: z.string(), documents: z.array(z.object({ type: z.string(), fileId: objectId, verified: z.boolean() })) });
export const staffQuery = listQuery.extend({ staffType: z.enum(vals(StaffType)).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), verified: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), vendorId: objectId.optional() });
export const verifyDocsBody = z.object({ verified: z.boolean(), documentTypes: z.array(z.string()).optional() });
export const attendanceBody = z.object({ date: dateOnly, status: z.enum(vals(AttendanceStatus)), checkIn: dateTime.optional(), checkOut: dateTime.optional(), note: z.string().max(200).optional() });
export const attendanceItem = entity({ staffId: objectId, date: z.string(), status: z.enum(vals(AttendanceStatus)), checkIn: dateTime.optional(), checkOut: dateTime.optional(), note: z.string().optional() });
export const attendanceQuery = z.object({ from: dateOnly.optional(), to: dateOnly.optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(31) });
export const performanceItem = z.object({ staffId: objectId, name: z.string(), attendance: z.object({ present: z.number().int(), absent: z.number().int(), leave: z.number().int() }), tasks: z.object({ assigned: z.number().int(), done: z.number().int(), overdue: z.number().int() }), complaints: z.object({ assigned: z.number().int(), resolved: z.number().int(), avgRating: z.number().nullable() }) });

const contract = z.object({ title: z.string().min(2).max(150), startDate: dateOnly, endDate: dateOnly, amount: money.optional(), fileId: objectId.optional(), status: z.enum(vals(ContractStatus)).default('ACTIVE') });
export const vendorBody = z.object({ name: z.string().trim().min(2).max(150), category: z.string().trim().min(2).max(50), contactPerson: z.string().max(100).optional(), mobile, email: email.optional(), gstin: z.string().max(20).optional(), verified: z.boolean().default(false), status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE') });
export const vendorItem = entity({ name: z.string(), category: z.string(), contactPerson: z.string().optional(), mobile: z.string(), email: z.string().optional(), verified: z.boolean(), status: z.string(), rating: z.number(), contracts: z.array(contract.extend({ id: objectId.optional() })) });
export const vendorQuery = listQuery.extend({ category: z.string().max(50).optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), verified: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });
export const contractBody = contract;

export const taskBody = z.object({ title: z.string().trim().min(3).max(150), description: z.string().max(1000).optional(), assigneeType: z.enum(['STAFF', 'ADMIN', 'VENDOR']), assigneeId: objectId, priority: z.enum(vals(Priority)).default('MEDIUM'), dueDate: dateTime.optional(), complaintId: objectId.optional() });
export const taskUpdate = taskBody.partial().extend({ status: z.enum(vals(TaskStatus)).optional() });
export const taskItem = entity({ title: z.string(), description: z.string().optional(), assigneeType: z.string(), assigneeId: objectId, priority: z.enum(vals(Priority)), status: z.enum(vals(TaskStatus)), dueDate: dateTime.optional(), completedAt: dateTime.optional() });
export const taskQuery = listQuery.extend({ status: z.enum(vals(TaskStatus)).optional(), priority: z.enum(vals(Priority)).optional(), assigneeId: objectId.optional(), assigneeType: z.enum(['STAFF', 'ADMIN', 'VENDOR']).optional() });

export const assetBody = z.object({ name: z.string().trim().min(2).max(150), kind: z.enum(['ASSET', 'INVENTORY']).default('ASSET'), category: z.string().max(50).optional(), serialNo: z.string().max(60).optional(), location: z.string().max(100).optional(), purchaseDate: dateOnly.optional(), cost: money.optional(), warrantyUntil: dateOnly.optional(), quantity: z.number().int().min(0).default(1), minQuantity: z.number().int().min(0).default(0), vendorId: objectId.optional(), nextServiceDate: dateOnly.optional(), status: z.enum(vals(AssetStatus)).default('IN_USE') });
export const assetItem = entity({ name: z.string(), kind: z.string(), category: z.string().optional(), serialNo: z.string().optional(), location: z.string().optional(), cost: z.number().optional(), quantity: z.number().int(), minQuantity: z.number().int(), status: z.enum(vals(AssetStatus)), nextServiceDate: z.string().optional() });
export const assetQuery = listQuery.extend({ kind: z.enum(['ASSET', 'INVENTORY']).optional(), status: z.enum(vals(AssetStatus)).optional(), category: z.string().max(50).optional() });
export const lowStockItem = z.object({ id: objectId, name: z.string(), quantity: z.number().int(), minQuantity: z.number().int() });
