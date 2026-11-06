import { Schema } from 'mongoose';
import { CalcMethod, ChargeType, ExpenseCategory, Frequency, InvoiceStatus, PaymentMethod, PaymentStatus, vals } from '../../common/constants/enums';
import { defineModel, makeSchema, ref, refReq } from '../../common/models/makeSchema';

export const Charge = defineModel(
  'Charge',
  makeSchema(
    {
      name: { type: String, required: true, trim: true },
      type: { type: String, enum: vals(ChargeType), default: 'MAINTENANCE' },
      amount: { type: Number, required: true, min: 0 },
      calcMethod: { type: String, enum: vals(CalcMethod), default: 'FIXED' },
      frequency: { type: String, enum: vals(Frequency), default: 'MONTHLY' },
      applyTo: { all: { type: Boolean, default: true }, towerIds: [ref('Tower')], flatIds: [ref('Flat')] },
      isActive: { type: Boolean, default: true },
      description: String,
    },
    { indexes: [[{ societyId: 1, isActive: 1 }]] },
  ),
);

export const Invoice = defineModel(
  'Invoice',
  makeSchema(
    {
      invoiceNumber: { type: String, required: true },
      kind: { type: String, enum: ['MAINTENANCE', 'AMENITY', 'ADHOC'], default: 'MAINTENANCE' },
      flatId: refReq('Flat', { index: true }),
      flatLabel: String,
      billedTo: ref('User'),
      period: String,
      title: { type: String, required: true },
      lineItems: [{ chargeId: ref('Charge'), title: { type: String, required: true }, type: String, amount: { type: Number, required: true } }],
      subtotal: { type: Number, required: true },
      penalty: { type: Number, default: 0 },
      adjustments: [{ label: String, amount: Number, by: ref('User'), at: { type: Date, default: Date.now } }],
      total: { type: Number, required: true },
      paidAmount: { type: Number, default: 0 },
      balance: { type: Number, required: true },
      dueDate: { type: Date, required: true, index: true },
      status: { type: String, enum: vals(InvoiceStatus), default: 'UNPAID', index: true },
      issuedAt: { type: Date, default: Date.now },
      dedupeKey: String,
      penaltyAppliedAt: Date,
      reminderSentAt: Date,
      refId: { type: Schema.Types.ObjectId },
    },
    { indexes: [[{ societyId: 1, invoiceNumber: 1 }, { unique: true }], [{ societyId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } }], [{ societyId: 1, flatId: 1, status: 1, dueDate: 1 }], [{ societyId: 1, status: 1, dueDate: 1 }]] },
  ),
);

export const Payment = defineModel(
  'Payment',
  makeSchema(
    {
      invoiceId: refReq('Invoice', { index: true }),
      flatId: refReq('Flat', { index: true }),
      userId: ref('User'),
      amount: { type: Number, required: true, min: 0.01 },
      method: { type: String, enum: vals(PaymentMethod), required: true },
      status: { type: String, enum: vals(PaymentStatus), default: 'INITIATED', index: true },
      gateway: String,
      gatewayOrderId: { type: String, index: true },
      gatewayPaymentId: String,
      receiptNumber: String,
      paidAt: Date,
      recordedBy: ref('User'),
      reference: String,
      idempotencyKey: String,
      failureReason: String,
      note: String,
    },
    { indexes: [[{ societyId: 1, userId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }], [{ societyId: 1, status: 1, paidAt: -1 }]] },
  ),
);

export const Expense = defineModel(
  'Expense',
  makeSchema(
    {
      category: { type: String, enum: vals(ExpenseCategory), required: true },
      title: { type: String, required: true },
      amount: { type: Number, required: true, min: 0 },
      vendorId: ref('Vendor'),
      date: { type: String, required: true, index: true },
      paymentStatus: { type: String, enum: ['PAID', 'PENDING'], default: 'PAID' },
      paymentMode: { type: String, enum: vals(PaymentMethod) },
      billFileId: ref('File'),
      notes: String,
      approvedBy: ref('User'),
    },
    { indexes: [[{ societyId: 1, date: -1 }], [{ societyId: 1, category: 1 }]] },
  ),
);
