import { Request, Response } from 'express';
import { UserType } from '../../common/constants/enums';
import { Permission as P } from '../../common/constants/permissions';
import { crudRoutes } from '../../common/openapi/crudRoutes';
import { ModuleRouter } from '../../common/openapi/router';
import { created, ok, paged } from '../../common/responses/respond';
import { crudController } from '../../common/services/crud.controller';
import { idParam } from '../../common/validators/common';
import { authLimiter } from '../../middleware/rateLimit.middleware';
import * as s from './payment.schema';
import { chargeService, createAdhocInvoice, expenseService, generateInvoices, invoiceAdmin, paymentAdmin, paymentResident, runOverdueAndPenalties } from './payment.service';

const sid = (r: Request) => r.auth.societyId!;

export const paymentResidentRouter = new ModuleRouter('/api/v1/user', {
  tag: 'Resident - Payments & Billing',
  tagDescription: 'Maintenance dues, utility bills, online payment through a gateway abstraction, invoices, receipts and transaction history',
  roles: [UserType.RESIDENT],
  societyScoped: true,
  feature: 'payments',
});
const scope = (r: Request) => ({ flatId: { $in: r.auth.flatIds } });
paymentResidentRouter
  .add({ method: 'get', path: '/invoices', summary: 'My invoices (maintenance, utilities, penalties, amenity charges)', query: s.invoiceQuery, response: s.invoiceItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await invoiceAdmin.list(sid(req), req.valid.query, scope(req))) })
  .add({ method: 'get', path: '/invoices/summary', summary: 'Outstanding and overdue amounts', response: s.duesSummary, handler: async (req: Request, res: Response) => ok(res, await paymentResident.dues(sid(req), req.auth.flatIds)) })
  .add({ method: 'get', path: '/invoices/:id', summary: 'Invoice detail (download-ready)', params: idParam, response: s.invoiceItem, handler: async (req: Request, res: Response) => ok(res, await invoiceAdmin.get(sid(req), req.valid.params.id, scope(req))) })
  .add({ method: 'post', path: '/invoices/:id/pay', summary: 'Start a payment for an invoice', description: 'Creates an INITIATED payment and a gateway order. Provide idempotencyKey to make retries safe. Partial payments are allowed. Outside production the mock checkout returns devHint with a valid paymentId and signature for /payments/{id}/verify.', params: idParam, body: s.payBody, response: s.payResponse, status: 201, errors: [400, 409], handler: async (req: Request, res: Response) => created(res, await paymentResident.pay(sid(req), req.auth.userId, req.auth.residents, req.valid.params.id, req.valid.body), 'Payment initiated') })
  .add({ method: 'post', path: '/payments/:id/verify', summary: 'Verify the gateway callback and settle the payment', description: 'Verifies the gateway signature, then atomically marks the payment SUCCESS, issues a receipt and updates the invoice balance.', params: idParam, body: s.verifyBody, response: s.paymentItem, status: 200, errors: [400, 409], handler: async (req: Request, res: Response) => ok(res, await paymentResident.verify(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Payment verified') })
  .add({ method: 'get', path: '/payments', summary: 'Transaction history', query: s.paymentQuery, response: s.paymentItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await paymentResident.list(sid(req), req.auth.userId, req.auth.flatIds, req.valid.query)) })
  .add({ method: 'get', path: '/payments/:id/receipt', summary: 'Payment receipt', params: idParam, response: s.receiptItem, handler: async (req: Request, res: Response) => ok(res, await paymentResident.receipt(sid(req), req.auth.flatIds, req.valid.params.id)) });

export const paymentWebhookRouter = new ModuleRouter('/api/v1/payments', { tag: 'Resident - Payments & Billing', roles: [UserType.RESIDENT] });
paymentWebhookRouter.add({ method: 'post', path: '/webhook', public: true, limiter: authLimiter, summary: 'Payment gateway webhook', description: 'Signed callback from the payment gateway. Idempotent: replays of a successful payment are ignored.', body: s.webhookBody, response: s.paymentItem, status: 200, errors: [401, 404, 409], handler: async (req: Request, res: Response) => ok(res, await paymentResident.webhook(req.valid.body), 'Processed') });

export const financeAdminRouter = new ModuleRouter('/api/v1/admin/finance', {
  tag: 'Society Admin - Finance',
  tagDescription: 'Recurring charges, maintenance billing, payments, penalties, expenses and financial reports',
  roles: [UserType.SOCIETY_ADMIN],
  societyScoped: true,
  feature: 'payments',
});
const fm = [P.FINANCE_MANAGE];
const fr = [P.FINANCE_READ];
crudRoutes(financeAdminRouter, { path: '/charges', name: 'Charge', controller: crudController(chargeService, { label: 'Charge' }), create: s.chargeBody, query: s.chargeQuery, item: s.chargeItem, read: fr, write: fm });
financeAdminRouter
  .add({ method: 'post', path: '/invoices/generate', summary: 'Generate maintenance bills for a period', description: 'Idempotent per flat+period: existing invoices are skipped. Quarterly/half-yearly/yearly charges are billed only in their due months unless chargeIds is given.', permissions: fm, body: s.generateBody, response: s.generateResult, status: 201, errors: [400], handler: async (req: Request, res: Response) => created(res, await generateInvoices(sid(req), req.auth.userId, req.valid.body), 'Invoices generated') })
  .add({ method: 'post', path: '/invoices', summary: 'Create an ad-hoc invoice (electricity, water, parking, etc.)', permissions: fm, body: s.adhocBody, response: s.invoiceItem, status: 201, errors: [404], handler: async (req: Request, res: Response) => created(res, await createAdhocInvoice(sid(req), req.auth.userId, req.valid.body), 'Invoice created') })
  .add({ method: 'get', path: '/invoices', summary: 'List invoices and outstanding dues', permissions: fr, query: s.invoiceQuery, response: s.invoiceItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await invoiceAdmin.list(sid(req), req.valid.query)) })
  .add({ method: 'get', path: '/invoices/:id', summary: 'Get invoice', permissions: fr, params: idParam, response: s.invoiceItem, handler: async (req: Request, res: Response) => ok(res, await invoiceAdmin.get(sid(req), req.valid.params.id)) })
  .add({ method: 'post', path: '/invoices/:id/adjust', summary: 'Add a waiver or adjustment (positive or negative)', permissions: fm, params: idParam, body: s.adjustBody, response: s.invoiceItem, status: 200, errors: [400, 409], handler: async (req: Request, res: Response) => ok(res, await invoiceAdmin.adjust(sid(req), req.auth.userId, req.valid.params.id, req.valid.body), 'Invoice adjusted') })
  .add({ method: 'post', path: '/invoices/:id/cancel', summary: 'Cancel an unpaid invoice', permissions: fm, params: idParam, body: s.cancelBody, response: s.invoiceItem, status: 200, errors: [409], handler: async (req: Request, res: Response) => ok(res, await invoiceAdmin.cancel(sid(req), req.auth.userId, req.valid.params.id, req.valid.body.reason), 'Invoice cancelled') })
  .add({ method: 'post', path: '/penalties/apply', summary: 'Mark overdue invoices and apply late-payment penalties', description: 'Uses the society finance.lateFee setting (FIXED or PERCENT, with grace days). Each invoice is penalised at most once.', permissions: fm, response: s.penaltyResult, status: 200, handler: async (req: Request, res: Response) => ok(res, await runOverdueAndPenalties(sid(req)), 'Penalties applied') })
  .add({ method: 'post', path: '/payments/offline', summary: 'Record a cash, cheque or bank-transfer payment', permissions: fm, body: s.offlinePaymentBody, response: s.paymentItem, status: 201, errors: [400, 404, 409], handler: async (req: Request, res: Response) => created(res, await paymentAdmin.recordOffline(sid(req), req.auth.userId, req.valid.body), 'Payment recorded') })
  .add({ method: 'get', path: '/payments', summary: 'Payment records', permissions: fr, query: s.paymentQuery, response: s.paymentItem, paginated: true, handler: async (req: Request, res: Response) => paged(res, await paymentAdmin.list(sid(req), req.valid.query)) })
  .add({ method: 'get', path: '/reports/summary', summary: 'Financial report: collections, expenses, outstanding, monthly trend', permissions: [P.REPORT_READ], query: s.financeReportQuery, response: s.financeReport, handler: async (req: Request, res: Response) => ok(res, await paymentAdmin.report(sid(req), req.valid.query)) });
crudRoutes(financeAdminRouter, { path: '/expenses', name: 'Expense', controller: crudController(expenseService, { label: 'Expense', prepare: (r, b) => ({ ...b, approvedBy: r.auth.userId }) }), create: s.expenseBody, query: s.expenseQuery, item: s.expenseItem, read: fr, write: [P.EXPENSE_MANAGE] });
