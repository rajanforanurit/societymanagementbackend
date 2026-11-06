import { ClientSession } from 'mongoose';
import { NotificationType } from '../../common/constants/enums';
import { ApiError } from '../../common/utils/apiError';
import { createCrudService } from '../../common/services/crud.service';
import { addDays } from '../../common/utils/dates';
import { oid } from '../../common/utils/objectId';
import { applyListFilters, paginate } from '../../common/utils/pagination';
import { withTransaction } from '../../common/utils/transaction';
import { writeAudit } from '../audit/audit.service';
import { Counter } from '../complaints/complaint.model';
import { notifyFlat, notifyUsers } from '../notifications/notify.service';
import { Resident } from '../resident/resident.model';
import { Flat, Society } from '../society/society.model';
import { Charge, Expense, Invoice, Payment } from './payment.model';
import { paymentGateway } from './gateway';

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const OPEN = ['UNPAID', 'PARTIALLY_PAID', 'OVERDUE'];

async function reserveSeq(key: string, n: number) {
  const c: any = await Counter.findOneAndUpdate({ key }, { $inc: { seq: n } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return c.seq - n + 1;
}
const invNo = async (societyId: string, n = 1) => {
  const s: any = await Society.findById(societyId).select('settings.finance.invoicePrefix');
  const prefix = s?.settings?.finance?.invoicePrefix ?? 'INV';
  const year = new Date().getUTCFullYear();
  const start = await reserveSeq(`invoice:${societyId}:${year}`, n);
  return Array.from({ length: n }, (_, i) => `${prefix}-${year}-${String(start + i).padStart(6, '0')}`);
};
const receiptNo = async (societyId: string) => {
  const year = new Date().getUTCFullYear();
  const n = await reserveSeq(`receipt:${societyId}:${year}`, 1);
  return `RCT-${year}-${String(n).padStart(6, '0')}`;
};

export const chargeService = createCrudService({ model: Charge, name: 'Charge', searchFields: ['name'], filterable: ['type', 'isActive'], sortable: ['name', 'createdAt'] });
export const expenseService = createCrudService({ model: Expense, name: 'Expense', searchFields: ['title', 'notes'], filterable: ['category', 'paymentStatus', 'vendorId'], sortable: ['date', 'amount', 'createdAt'], defaultSort: '-date' });

const freqDue = (freq: string, month: number) => freq === 'MONTHLY' || (freq === 'QUARTERLY' && [1, 4, 7, 10].includes(month)) || (freq === 'HALF_YEARLY' && [1, 7].includes(month)) || (freq === 'YEARLY' && month === 1);

export async function generateInvoices(societyId: string, actorId: string, body: any) {
  const society: any = await Society.findById(societyId).select('settings.finance');
  const month = Number(body.period.slice(5, 7));
  const charges: any[] = await Charge.find({ societyId, isActive: true, ...(body.chargeIds?.length ? { _id: { $in: body.chargeIds } } : {}) });
  const useCharges = charges.filter((c) => (body.chargeIds?.length ? true : freqDue(c.frequency, month) && c.frequency !== 'ONE_TIME'));
  if (!useCharges.length) throw ApiError.badRequest('No active charges apply for this period', 'NO_CHARGES');
  const flats: any[] = await Flat.find({ societyId, status: { $ne: 'BLOCKED' }, ...(body.towerIds?.length ? { towerId: { $in: body.towerIds } } : {}) });
  const primaries: any[] = await Resident.find({ societyId, status: 'APPROVED', isPrimary: true }).select('flatId userId');
  const primaryOf = new Map(primaries.map((r) => [String(r.flatId), r.userId]));
  const dueDate = body.dueDate ? new Date(`${body.dueDate}T23:59:59.999Z`) : addDays(new Date(), society?.settings?.finance?.dueDays ?? 10);
  const docs: any[] = [];
  for (const f of flats) {
    const items = useCharges
      .filter((c) => c.applyTo?.all || (f.towerId && c.applyTo?.towerIds?.some((t: any) => String(t) === String(f.towerId))) || c.applyTo?.flatIds?.some((x: any) => String(x) === String(f._id)))
      .map((c) => ({ chargeId: c._id, title: c.name, type: c.type, amount: round2(c.calcMethod === 'PER_SQFT' ? (f.areaSqft ?? 0) * c.amount : c.amount) }))
      .filter((i) => i.amount > 0);
    if (!items.length) continue;
    const subtotal = round2(items.reduce((s, i) => s + i.amount, 0));
    docs.push({ societyId, kind: 'MAINTENANCE', flatId: f._id, flatLabel: f.label, billedTo: primaryOf.get(String(f._id)), period: body.period, title: `Maintenance ${body.period}`, lineItems: items, subtotal, total: subtotal, balance: subtotal, dueDate, dedupeKey: `${f._id}:${body.period}:MAINTENANCE`, createdBy: actorId });
  }
  if (!docs.length) return { period: body.period, created: 0, skippedExisting: 0, totalBilled: 0 };
  const existing: any[] = await Invoice.find({ societyId, dedupeKey: { $in: docs.map((d) => d.dedupeKey) } }).select('dedupeKey');
  const have = new Set(existing.map((e) => e.dedupeKey));
  const fresh = docs.filter((d) => !have.has(d.dedupeKey));
  if (fresh.length) {
    const numbers = await invNo(societyId, fresh.length);
    fresh.forEach((d, i) => (d.invoiceNumber = numbers[i]));
    try {
      await Invoice.insertMany(fresh, { ordered: false });
    } catch (e: any) {
      if (e?.code !== 11000 && !e?.writeErrors) throw e;
    }
    const withUser = fresh.filter((d) => d.billedTo);
    await notifyUsers({ societyId, userIds: withUser.map((d) => d.billedTo), type: NotificationType.PAYMENT, title: `Maintenance bill for ${body.period}`, body: 'Your maintenance invoice has been generated.', data: { period: body.period }, event: 'invoice:generated' });
  }
  await writeAudit({ actorId, actorRole: 'SOCIETY_ADMIN', societyId, action: 'INVOICES_GENERATED', entityType: 'Invoice', metadata: { period: body.period, created: fresh.length } });
  return { period: body.period, created: fresh.length, skippedExisting: docs.length - fresh.length, totalBilled: round2(fresh.reduce((s, d) => s + d.total, 0)) };
}

export async function createAdhocInvoice(societyId: string, actorId: string, body: any) {
  const flat: any = await Flat.findOne({ _id: body.flatId, societyId });
  if (!flat) throw ApiError.notFound('Flat not found');
  const primary: any = await Resident.findOne({ societyId, flatId: flat._id, status: 'APPROVED', isPrimary: true });
  const items = body.items.map((i: any) => ({ title: i.title, type: i.type ?? 'OTHER', amount: round2(i.amount) }));
  const subtotal = round2(items.reduce((s: number, i: any) => s + i.amount, 0));
  const [num] = await invNo(societyId);
  const inv: any = await Invoice.create({ societyId, kind: 'ADHOC', flatId: flat._id, flatLabel: flat.label, billedTo: primary?.userId, title: body.title, lineItems: items, subtotal, total: subtotal, balance: subtotal, dueDate: new Date(`${body.dueDate}T23:59:59.999Z`), invoiceNumber: num, createdBy: actorId });
  if (primary) await notifyFlat(societyId, String(flat._id), { type: NotificationType.PAYMENT, title: 'New invoice', body: `${body.title}: ${subtotal}`, data: { invoiceId: String(inv._id) }, event: 'invoice:generated' }, 'canPayBills');
  return inv;
}

export async function createAmenityInvoice(societyId: string, userId: string, flatId: string, flatLabel: string | undefined, title: string, amount: number, refId: string, session?: ClientSession) {
  const [num] = await invNo(societyId);
  const [inv]: any[] = await Invoice.create([{ societyId, kind: 'AMENITY', flatId, flatLabel, billedTo: userId, title, lineItems: [{ title, type: 'AMENITY', amount }], subtotal: amount, total: amount, balance: amount, dueDate: addDays(new Date(), 3), invoiceNumber: num, refId, createdBy: userId }], { session });
  return inv;
}

export const invoiceAdmin = {
  async list(societyId: string, q: any, scope: Record<string, unknown> = {}) {
    const f: Record<string, unknown> = { societyId, ...scope };
    ['status', 'flatId', 'period', 'kind'].forEach((k) => q[k] && (f[k] = q[k]));
    return paginate(Invoice, applyListFilters(f, q, ['invoiceNumber', 'flatLabel', 'title']), q, { sortable: ['createdAt', 'dueDate', 'total', 'balance'] });
  },
  async get(societyId: string, id: string, scope: Record<string, unknown> = {}) {
    const i = await Invoice.findOne({ _id: id, societyId, ...scope });
    if (!i) throw ApiError.notFound('Invoice not found');
    return i;
  },
  async cancel(societyId: string, actorId: string, id: string, reason: string) {
    const i = await Invoice.findOneAndUpdate({ _id: id, societyId, paidAmount: 0, status: { $in: OPEN } }, { $set: { status: 'CANCELLED', balance: 0, updatedBy: actorId }, $push: { adjustments: { label: `Cancelled: ${reason}`, amount: 0, by: actorId } } }, { new: true });
    if (!i) throw ApiError.conflict('Only unpaid open invoices can be cancelled', 'INVALID_STATE');
    await writeAudit({ actorId, actorRole: 'SOCIETY_ADMIN', societyId, action: 'INVOICE_CANCELLED', entityType: 'Invoice', entityId: id, metadata: { reason } });
    return i;
  },
  async adjust(societyId: string, actorId: string, id: string, body: { label: string; amount: number }) {
    const inv: any = await Invoice.findOne({ _id: id, societyId, status: { $in: OPEN } });
    if (!inv) throw ApiError.conflict('Only open invoices can be adjusted', 'INVALID_STATE');
    const newTotal = round2(inv.total + body.amount);
    if (newTotal < inv.paidAmount) throw ApiError.badRequest('Adjustment would reduce the total below the amount already paid', 'ADJUSTMENT_TOO_LARGE');
    const balance = round2(newTotal - inv.paidAmount);
    const r = await Invoice.findOneAndUpdate({ _id: id, societyId, total: inv.total }, { $set: { total: newTotal, balance, status: balance <= 0 ? 'PAID' : inv.status, updatedBy: actorId }, $push: { adjustments: { label: body.label, amount: body.amount, by: actorId } } }, { new: true });
    if (!r) throw ApiError.conflict('Invoice changed concurrently', 'CONCURRENT_UPDATE');
    await writeAudit({ actorId, actorRole: 'SOCIETY_ADMIN', societyId, action: 'INVOICE_ADJUSTED', entityType: 'Invoice', entityId: id, after: body });
    return r;
  },
};

export async function applySuccessfulPayment(societyId: string, paymentId: string, extra: { gatewayPaymentId?: string; recordedBy?: string } = {}) {
  const receipt = await receiptNo(societyId);
  const result = await withTransaction(async (session) => {
    const p: any = await Payment.findOneAndUpdate({ _id: paymentId, societyId, status: { $in: ['INITIATED', 'PENDING_VERIFICATION'] } }, { $set: { status: 'SUCCESS', paidAt: new Date(), receiptNumber: receipt, gatewayPaymentId: extra.gatewayPaymentId, ...(extra.recordedBy ? { recordedBy: extra.recordedBy } : {}) } }, { new: true, session });
    if (!p) {
      const already: any = await Payment.findOne({ _id: paymentId, societyId }).session(session ?? null);
      if (already?.status === 'SUCCESS') return { payment: already, replay: true };
      throw ApiError.conflict('Payment cannot be completed in its current state', 'INVALID_STATE');
    }
    const inv: any = await Invoice.findOneAndUpdate({ _id: p.invoiceId, societyId, status: { $in: OPEN }, balance: { $gte: round2(p.amount) } }, { $inc: { paidAmount: p.amount, balance: -p.amount } }, { new: true, session });
    if (!inv) throw ApiError.conflict('Invoice is closed or the amount exceeds the outstanding balance', 'INVOICE_NOT_PAYABLE');
    const balance = round2(inv.balance);
    const status = balance <= 0 ? 'PAID' : inv.dueDate < new Date() ? 'OVERDUE' : 'PARTIALLY_PAID';
    await Invoice.updateOne({ _id: inv._id, societyId }, { $set: { balance, paidAmount: round2(inv.paidAmount), status } }, { session });
    await writeAudit({ actorId: extra.recordedBy ?? (p.userId ? String(p.userId) : undefined), societyId, action: 'PAYMENT_SUCCESS', entityType: 'Payment', entityId: String(p._id), after: { amount: p.amount, invoiceId: String(p.invoiceId), receipt } }, session);
    return { payment: p, replay: false, invoice: inv };
  });
  if (!result.replay && result.payment.userId) {
    await notifyUsers({ societyId, userIds: [result.payment.userId], type: NotificationType.PAYMENT, title: 'Payment received', body: `Receipt ${result.payment.receiptNumber}: ${result.payment.amount}`, data: { paymentId: String(result.payment._id) }, event: 'payment:success' });
  }
  return result.payment;
}

export const paymentResident = {
  async pay(societyId: string, userId: string, residents: { flatId: string; permissions: Record<string, boolean> }[], invoiceId: string, body: any) {
    const inv: any = await Invoice.findOne({ _id: invoiceId, societyId, flatId: { $in: residents.map((r) => r.flatId) } });
    if (!inv) throw ApiError.notFound('Invoice not found');
    const me = residents.find((r) => r.flatId === String(inv.flatId))!;
    if (me.permissions.canPayBills === false) throw ApiError.forbidden('You are not permitted to pay bills', 'RESIDENT_PERMISSION_DENIED');
    if (!OPEN.includes(inv.status)) throw ApiError.conflict(`Invoice is ${inv.status}`, 'INVOICE_NOT_PAYABLE');
    const amount = round2(body.amount ?? inv.balance);
    if (amount <= 0 || amount > inv.balance) throw ApiError.badRequest('Amount must be between 0 and the outstanding balance', 'INVALID_AMOUNT');
    if (body.idempotencyKey) {
      const prev: any = await Payment.findOne({ societyId, userId, idempotencyKey: body.idempotencyKey });
      if (prev) return { payment: prev, checkout: { provider: prev.gateway, orderId: prev.gatewayOrderId, replay: true } };
    }
    const order = await paymentGateway.createOrder({ amount, currency: 'INR', receipt: inv.invoiceNumber });
    try {
      const payment = await Payment.create({ societyId, invoiceId, flatId: inv.flatId, userId, amount, method: body.method, gateway: paymentGateway.name, gatewayOrderId: order.orderId, idempotencyKey: body.idempotencyKey, createdBy: userId });
      return { payment, checkout: order.checkout };
    } catch (e: any) {
      if (e?.code === 11000) throw ApiError.conflict('Duplicate payment request', 'DUPLICATE_REQUEST');
      throw e;
    }
  },
  async verify(societyId: string, userId: string, paymentId: string, body: { gatewayPaymentId: string; signature: string }) {
    const p: any = await Payment.findOne({ _id: paymentId, societyId, userId });
    if (!p) throw ApiError.notFound('Payment not found');
    if (p.status === 'SUCCESS') return p;
    if (!paymentGateway.verify({ orderId: p.gatewayOrderId, paymentId: body.gatewayPaymentId, signature: body.signature })) {
      await writeAudit({ actorId: userId, societyId, action: 'PAYMENT_SIGNATURE_INVALID', entityType: 'Payment', entityId: paymentId });
      throw ApiError.badRequest('Payment signature verification failed', 'SIGNATURE_INVALID');
    }
    return applySuccessfulPayment(societyId, paymentId, { gatewayPaymentId: body.gatewayPaymentId });
  },
  async webhook(body: { orderId: string; paymentId: string; status: string; signature: string; failureReason?: string }) {
    if (!paymentGateway.verify({ orderId: body.orderId, paymentId: body.paymentId, signature: body.signature })) throw ApiError.unauthorized('Invalid webhook signature', 'SIGNATURE_INVALID');
    const p: any = await Payment.findOne({ gatewayOrderId: body.orderId }).setOptions({ skipTenantCheck: true });
    if (!p) throw ApiError.notFound('Payment not found');
    if (body.status === 'SUCCESS') return applySuccessfulPayment(String(p.societyId), String(p._id), { gatewayPaymentId: body.paymentId });
    await Payment.updateOne({ _id: p._id, societyId: p.societyId, status: { $in: ['INITIATED', 'PENDING_VERIFICATION'] } }, { $set: { status: 'FAILED', failureReason: body.failureReason ?? 'Gateway reported failure' } });
    return Payment.findOne({ _id: p._id, societyId: p.societyId });
  },
  async list(societyId: string, userId: string, flatIds: string[], q: any) {
    const f: Record<string, unknown> = { societyId, $or: [{ userId }, { flatId: { $in: flatIds.map(oid) } }] };
    ['status', 'invoiceId', 'method'].forEach((k) => q[k] && (f[k] = q[k]));
    return paginate(Payment, applyListFilters(f, q), q, { sortable: ['createdAt', 'paidAt', 'amount'] });
  },
  async receipt(societyId: string, flatIds: string[], id: string) {
    const p: any = await Payment.findOne({ _id: id, societyId, status: 'SUCCESS', flatId: { $in: flatIds.map(oid) } });
    if (!p) throw ApiError.notFound('Receipt not found');
    const inv: any = await Invoice.findOne({ _id: p.invoiceId, societyId });
    const s: any = await Society.findById(societyId).select('name');
    return { receiptNumber: p.receiptNumber, paidAt: p.paidAt, amount: p.amount, method: p.method, invoiceNumber: inv?.invoiceNumber, invoiceTitle: inv?.title, flatLabel: inv?.flatLabel, balanceAfter: inv?.balance ?? 0, societyName: s?.name };
  },
  async dues(societyId: string, flatIds: string[]) {
    const [r] = await Invoice.aggregate([{ $match: { societyId: oid(societyId), flatId: { $in: flatIds.map(oid) }, status: { $in: OPEN } } }, { $group: { _id: null, total: { $sum: '$balance' }, overdue: { $sum: { $cond: [{ $lt: ['$dueDate', new Date()] }, '$balance', 0] } }, n: { $sum: 1 } } }]);
    return { totalOutstanding: round2(r?.total ?? 0), overdue: round2(r?.overdue ?? 0), invoices: r?.n ?? 0 };
  },
};

export const paymentAdmin = {
  async recordOffline(societyId: string, actorId: string, body: any) {
    const inv: any = await Invoice.findOne({ _id: body.invoiceId, societyId, status: { $in: OPEN } });
    if (!inv) throw ApiError.notFound('Open invoice not found');
    const amount = round2(body.amount);
    if (amount > inv.balance) throw ApiError.badRequest('Amount exceeds the outstanding balance', 'INVALID_AMOUNT');
    const p: any = await Payment.create({ societyId, invoiceId: inv._id, flatId: inv.flatId, userId: inv.billedTo, amount, method: body.method, status: 'PENDING_VERIFICATION', gateway: 'offline', reference: body.reference, note: body.note, recordedBy: actorId, createdBy: actorId });
    return applySuccessfulPayment(societyId, String(p._id), { recordedBy: actorId });
  },
  async list(societyId: string, q: any) {
    const f: Record<string, unknown> = { societyId };
    ['status', 'invoiceId', 'method'].forEach((k) => q[k] && (f[k] = q[k]));
    return paginate(Payment, applyListFilters(f, q, ['receiptNumber', 'reference']), q, { sortable: ['createdAt', 'paidAt', 'amount'] });
  },
  async report(societyId: string, q: { from?: string; to?: string }) {
    const sid = oid(societyId);
    const range = (field: string) => (q.from || q.to ? { [field]: { ...(q.from ? { $gte: field === 'date' ? q.from : new Date(q.from) } : {}), ...(q.to ? { $lte: field === 'date' ? q.to : new Date(`${q.to}T23:59:59.999Z`) } : {}) } } : {});
    const [coll, exp, expCat, out, billed] = await Promise.all([
      Payment.aggregate([{ $match: { societyId: sid, status: 'SUCCESS', ...range('paidAt') } }, { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$paidAt' } }, total: { $sum: '$amount' } } }]),
      Expense.aggregate([{ $match: { societyId: sid, paymentStatus: 'PAID', ...range('date') } }, { $group: { _id: { $substrBytes: ['$date', 0, 7] }, total: { $sum: '$amount' } } }]),
      Expense.aggregate([{ $match: { societyId: sid, paymentStatus: 'PAID', ...range('date') } }, { $group: { _id: '$category', total: { $sum: '$amount' } } }]),
      Invoice.aggregate([{ $match: { societyId: sid, status: { $in: OPEN } } }, { $group: { _id: null, total: { $sum: '$balance' }, overdue: { $sum: { $cond: [{ $lt: ['$dueDate', new Date()] }, 1, 0] } } } }]),
      Invoice.aggregate([{ $match: { societyId: sid, status: { $ne: 'CANCELLED' }, ...range('issuedAt') } }, { $group: { _id: null, total: { $sum: '$total' } } }]),
    ]);
    const months = [...new Set([...coll.map((c: any) => c._id), ...exp.map((e: any) => e._id)])].sort();
    const collected = round2(coll.reduce((s: number, c: any) => s + c.total, 0));
    const expenses = round2(exp.reduce((s: number, e: any) => s + e.total, 0));
    const totalBilled = billed[0]?.total ?? 0;
    return { collected, expenses, net: round2(collected - expenses), outstanding: round2(out[0]?.total ?? 0), overdueInvoices: out[0]?.overdue ?? 0, collectionEfficiency: totalBilled ? Math.round((collected / totalBilled) * 1000) / 10 : null, monthly: months.map((m) => ({ month: m, collected: round2(coll.find((c: any) => c._id === m)?.total ?? 0), expenses: round2(exp.find((e: any) => e._id === m)?.total ?? 0) })), expensesByCategory: Object.fromEntries(expCat.map((e: any) => [e._id, round2(e.total)])) };
  },
};

export async function runOverdueAndPenalties(onlySociety?: string) {
  const societies: any[] = await Society.find({ status: 'ACTIVE', ...(onlySociety ? { _id: onlySociety } : {}) }).select('settings.finance');
  let overdueMarked = 0;
  let penaltiesApplied = 0;
  for (const s of societies) {
    const fee = s.settings?.finance?.lateFee ?? {};
    const cutoff = addDays(new Date(), -(fee.graceDays ?? 0));
    const sid = String(s._id);
    const due: any[] = await Invoice.find({ societyId: sid, status: { $in: ['UNPAID', 'PARTIALLY_PAID'] }, dueDate: { $lt: new Date() } }).limit(1000);
    for (const inv of due) {
      const applyFee = !inv.penaltyAppliedAt && fee.value > 0 && inv.dueDate < cutoff && inv.kind !== 'AMENITY';
      const penalty = applyFee ? round2(fee.type === 'PERCENT' ? (inv.balance * fee.value) / 100 : fee.value) : 0;
      const set: Record<string, unknown> = { status: 'OVERDUE' };
      const inc: Record<string, number> = {};
      if (penalty > 0) {
        Object.assign(set, { penalty: round2(inv.penalty + penalty), penaltyAppliedAt: new Date() });
        Object.assign(inc, { total: penalty, balance: penalty });
      }
      const r = await Invoice.updateOne({ _id: inv._id, societyId: sid, status: { $in: ['UNPAID', 'PARTIALLY_PAID'] } }, { $set: set, ...(Object.keys(inc).length ? { $inc: inc } : {}) });
      if (r.modifiedCount) {
        overdueMarked++;
        if (penalty > 0) penaltiesApplied++;
        if (inv.billedTo) await notifyUsers({ societyId: sid, userIds: [inv.billedTo], type: NotificationType.PAYMENT, title: 'Payment overdue', body: `${inv.title} is overdue.${penalty > 0 ? ` A late fee of ${penalty} was added.` : ''}`, data: { invoiceId: String(inv._id) }, event: 'invoice:overdue' });
      }
    }
  }
  return { overdueMarked, penaltiesApplied };
}

export async function sendPaymentReminders() {
  const soon = addDays(new Date(), 3);
  const list: any[] = await Invoice.find({ status: { $in: ['UNPAID', 'PARTIALLY_PAID'] }, dueDate: { $gt: new Date(), $lt: soon }, reminderSentAt: null }).setOptions({ skipTenantCheck: true }).limit(500);
  for (const inv of list) {
    await Invoice.updateOne({ _id: inv._id, societyId: inv.societyId }, { $set: { reminderSentAt: new Date() } });
    if (inv.billedTo) await notifyUsers({ societyId: String(inv.societyId), userIds: [inv.billedTo], type: NotificationType.PAYMENT, title: 'Payment reminder', body: `${inv.title} is due soon.`, data: { invoiceId: String(inv._id) }, event: 'invoice:reminder' });
  }
}
