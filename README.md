# Society Management Backend

Multi-tenant society management API (MyGate-style) built with Node.js, Express, TypeScript, MongoDB/Mongoose, Zod, JWT, Socket.IO and an OpenAPI 3.1 specification.

## Run locally

```bash
npm install
docker compose up -d        # MongoDB 7 as a single-node replica set (required for transactions)
npm run seed -- --demo      # super admin + demo society, admin, guard and resident
npm run dev
```

- Swagger UI: http://localhost:4000/api-docs
- OpenAPI JSON: http://localhost:4000/api-docs.json (also generated to `src/docs/openapi.yaml` with `npm run docs:generate`)
- Health: http://localhost:4000/health

Without Docker, point `MONGODB_URI` at any MongoDB replica set. For a standalone `mongod` set `ENABLE_TRANSACTIONS=false` (multi-document writes then lose atomicity).

Seeded logins (change before any real use): super admin `+919999999999 / ChangeMe@123`, demo admin `+919000000001 / Admin@12345`, guard `+919000000002 / Guard@12345`, resident `+919000000003 / Resident@12345`.

In Swagger UI call `POST /api/v1/auth/login`, copy `accessToken`, press **Authorize**.

## Architecture

```
src/
  config/        env (Zod), database, swagger
  middleware/    auth, role, permission, validate, audit, rate-limit, error
  common/        constants (enums, permissions), openapi registry + route helpers, crud factory, utils
  modules/<m>/   <m>.model.ts, <m>.schema.ts (Zod), <m>.service.ts, <m>.controller.ts, <m>.routes.ts
  realtime/      Socket.IO
  jobs/          in-process scheduler (no external queue)
```

Each route is declared once with `ModuleRouter.add({...})`. The same declaration wires the Express middleware chain (authenticate → role → society → feature flag → permission → audit → Zod validation → handler) and registers the OpenAPI operation (parameters, request body, response schema, examples, error responses, required role and permissions), so the documentation cannot drift from the implementation.

### Roles and prefixes

| Prefix | Role |
| --- | --- |
| `/api/v1/auth` | public + any authenticated user |
| `/api/v1/super-admin` | `SUPER_ADMIN` |
| `/api/v1/admin` | `SOCIETY_ADMIN` with permission checks |
| `/api/v1/guard` | `GUARD` |
| `/api/v1/user` | `RESIDENT` |
| `/api/v1/files`, `/notifications`, `/announcements`, `/payments/webhook` | shared |

### Multi-tenancy

- The society is carried in the JWT (`sid`) and re-validated against live membership on every request (admin profile, guard assignment or approved residency). Client-supplied society ids are never trusted.
- Every tenant collection has `societyId`. A Mongoose guard throws on any find/update/delete/aggregate that does not filter by `societyId` (reads by `_id` alone are only allowed so `populate` works). Cross-tenant platform queries must opt in with `skipTenantCheck`.
- Super admin access to a society happens only through `POST /super-admin/societies/{id}/impersonate`: a written reason, a short-lived token, and every request made with it is written to the audit log with the session id.

### Approval workflow

`DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED → PUBLISHED → EXPIRED/REMOVED` (plus `CHANGES_REQUESTED` and `SUSPENDED`). One reusable service (`approvals/approval.service.ts`) drives marketplace listings, property listings, community posts and move-in/out requests. Transitions are atomic and recorded in `ApprovalRequest.history` and the audit log. Only `APPROVED`/`PUBLISHED`, unexpired, open listings are returned to other residents.

### Security notes

bcrypt password hashing, access + rotating refresh JWTs with reuse detection, OTP (hashed, attempt-limited), account lockout, session revocation through `tokenVersion`, Helmet, CORS, rate limiting, Zod validation with unknown-key stripping, upload signature checks, immutable audit collection, no stack traces in responses. Guards only receive flat labels and visitor details; parcel OTPs go to residents only.

### Notes and limits

- OTP delivery has no SMS provider: outside production the OTP is returned as `devOtp`. Plug a provider into `auth.service.requestOtp`.
- Payments use a gateway abstraction with a mock gateway (`modules/payments/gateway.ts`); outside production the checkout response contains a valid signature for testing `POST /user/payments/{id}/verify`.
- Rate limiting and the scheduler are in-process (single instance). Scheduler jobs are idempotent.
- Files are stored on local disk (`UPLOAD_DIR`) and served through authenticated, tenant-checked endpoints.
- Receipts and invoices are returned as JSON; no PDF renderer is bundled.

## Tests

```bash
npm test                                   # unit tests: OpenAPI validity/coverage, RBAC metadata, workflow, tenant guard
TEST_MONGODB_URI=mongodb://127.0.0.1:27017/society_test?replicaSet=rs0 npm test   # + end-to-end suites
```

Uses Node's built-in test runner (`node:test`) and `fetch`; no Jest or Supertest.

## Real-time events (Socket.IO)

Connect with `io(url, { auth: { token: accessToken } })`. Rooms are joined automatically. Events: `notification:new`, `visitor:arrived`, `visitor:decision`, `visitor:entered`, `visitor:exited`, `visitor:overstay`, `delivery:arrived`, `delivery:decision`, `delivery:left-at-gate`, `emergency:alert`, `emergency:updated`, `chat:message`, `chat:typing`, `approval:updated`, `complaint:updated`, `payment:success`, `booking:decided`.
