import { z } from 'zod';
import { CalcMethod, ChargeType, ExpenseCategory, Frequency, InvoiceStatus, PaymentMethod, PaymentStatus, vals } from '../../common/constants/enums';
import { entity } from '../../common/responses/schemas';
import { dateOnly, dateTime, listQuery, money, objectId } from '../../common/validators/common';

const audience = z.object({ all: z.boolean().default(true), towerIds: z.array(objectId).default([]), flatIds: z.array(objectId).default([]) });
export const chargeBody = z.object({ name: z.string().trim().min(2).max(100), type: z.enum(vals(ChargeType)).default('MAINTENANCE'), amount: money, calcMethod: z.enum(vals(CalcMethod)).default('FIXED'), frequency: z.enum(vals(Frequency)).default('MONTHLY'), applyTo: audience.default({ all: true, towerIds: [], flatIds: [] }), isActive: z.boolean().default(true), description: z.string().max(300).optional() });
export const chargeItem = entity({ name: z.string(), type: z.enum(vals(ChargeType)), amount: z.number(), calcMethod: z.enum(vals(CalcMethod)), frequency: z.enum(vals(Frequency)), applyTo: audience, isActive: z.boolean() });
export const chargeQuery = listQuery.extend({ type: z.enum(vals(ChargeType)).optional(), isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional() });

const lineItem = z.object({ chargeId: objectId.optional(), title: z.string(), type: z.string().optional(), amount: z.number() });
export const invoiceItem = entity({
  invoiceNumber: z.string(),
  kind: z.enum(['MAINTENANCE', 'AMENITY', 'ADHOC']),
  flatId: objectId,
  flatLabel: z.string().optional(),
  period: z.string().optional(),
  title: z.string(),
  lineItems: z.array(lineItem),
  subtotal: z.number(),
  penalty: z.number(),
  adjustments: z.array(z.object({ label: z.string().optional(), amount: z.number().optional() })),
  total: z.number(),
  paidAmount: z.number(),
  balance: z.number(),
  dueDate: dateTime,
  status: z.enum(vals(InvoiceStatus)),
  issuedAt: dateTime,
});
export const invoiceQuery = listQuery.extend({ status: z.enum(vals(InvoiceStatus)).optional(), flatId: objectId.optional(), period: z.string().regex(/^\d{4}-\d{2}$/).optional(), kind: z.enum(['MAINTENANCE', 'AMENITY', 'ADHOC']).optional() });
export const generateBody = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), chargeIds: z.array(objectId).max(50).optional(), dueDate: dateOnly.optional(), towerIds: z.array(objectId).optional() });
export const generateResult = z.object({ period: z.string(), created: z.number().int(), skippedExisting: z.number().int(), totalBilled: z.number() });
export const adhocBody = z.object({ flatId: objectId, title: z.string().trim().min(3).max(150), items: z.array(z.object({ title: z.string().min(1).max(100), amount: money, type: z.enum(vals(ChargeType)).optional() })).min(1).max(20), dueDate: dateOnly });
export const adjustBody = z.object({ label: z.string().trim().min(2).max(100), amount: z.number().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, 'Amount cannot be zero') });
export const cancelBody = z.object({ reason: z.string().trim().min(3).max(300) });

export const paymentItem = entity({ invoiceId: objectId, flatId: objectId, userId: objectId.optional(), amount: z.number(), method: z.enum(vals(PaymentMethod)), status: z.enum(vals(PaymentStatus)), gateway: z.string().optional(), gatewayOrderId: z.string().optional(), receiptNumber: z.string().optional(), paidAt: dateTime.optional(), reference: z.string().optional() });
export const paymentQuery = listQuery.extend({ status: z.enum(vals(PaymentStatus)).optional(), invoiceId: objectId.optional(), method: z.enum(vals(PaymentMethod)).optional() });
export const payBody = z.object({ amount: money.refine((v) => v > 0, 'Amount must be positive').optional(), method: z.enum(['ONLINE', 'UPI', 'CARD', 'NET_BANKING']).default('ONLINE'), idempotencyKey: z.string().min(8).max(64).optional() });
export const payResponse = z.object({ payment: paymentItem, checkout: z.record(z.string(), z.any()) });
export const verifyBody = z.object({ gatewayPaymentId: z.string().min(3).max(100), signature: z.string().min(10).max(200) });
export const webhookBody = z.object({ orderId: z.string().min(3), paymentId: z.string().min(3), status: z.enum(['SUCCESS', 'FAILED']), signature: z.string().min(10), failureReason: z.string().max(200).optional() });
export const offlinePaymentBody = z.object({ invoiceId: objectId, amount: money.refine((v) => v > 0), method: z.enum(['CASH', 'CHEQUE', 'BANK_TRANSFER', 'UPI']), reference: z.string().max(100).optional(), note: z.string().max(300).optional() });
export const receiptItem = z.object({ receiptNumber: z.string(), paidAt: dateTime, amount: z.number(), method: z.string(), invoiceNumber: z.string(), invoiceTitle: z.string(), flatLabel: z.string().optional(), balanceAfter: z.number(), societyName: z.string().optional() });
export const duesSummary = z.object({ totalOutstanding: z.number(), overdue: z.number(), invoices: z.number().int() });

export const expenseBody = z.object({ category: z.enum(vals(ExpenseCategory)), title: z.string().trim().min(2).max(150), amount: money, vendorId: objectId.optional(), date: dateOnly, paymentStatus: z.enum(['PAID', 'PENDING']).default('PAID'), paymentMode: z.enum(vals(PaymentMethod)).optional(), billFileId: objectId.optional(), notes: z.string().max(500).optional() });
export const expenseItem = entity({ category: z.enum(vals(ExpenseCategory)), title: z.string(), amount: z.number(), vendorId: objectId.optional(), date: z.string(), paymentStatus: z.string(), paymentMode: z.string().optional() });
export const expenseQuery = listQuery.extend({ category: z.enum(vals(ExpenseCategory)).optional(), paymentStatus: z.enum(['PAID', 'PENDING']).optional(), vendorId: objectId.optional() });
export const financeReportQuery = z.object({ from: dateOnly.optional(), to: dateOnly.optional() });
export const financeReport = z.object({
  collected: z.number(),
  expenses: z.number(),
  net: z.number(),
  outstanding: z.number(),
  overdueInvoices: z.number().int(),
  collectionEfficiency: z.number().nullable(),
  monthly: z.array(z.object({ month: z.string(), collected: z.number(), expenses: z.number() })),
  expensesByCategory: z.record(z.string(), z.number()),
});
export const penaltyResult = z.object({ overdueMarked: z.number().int(), penaltiesApplied: z.number().int() });
