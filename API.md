# Ledger API — Endpoint Reference

Base URL: `http://localhost:3001/api`

All protected endpoints require:
- `Authorization: Bearer <accessToken>` header
- `x-org-id: <orgId>` header (or `:orgId` in path)

---

## Auth

| Method | Path | Auth | Body |
|--------|------|------|------|
| POST | `/auth/register` | — | `{ fullName, email, password, orgName }` |
| POST | `/auth/login` | — | `{ email, password }` |
| POST | `/auth/refresh` | cookie | — |
| POST | `/auth/logout` | JWT | — |
| GET  | `/auth/me` | JWT | — |

**Register response:**
```json
{ "data": { "user": {...}, "org": {...}, "accessToken": "eyJ..." } }
```

**Login response:**
```json
{ "data": { "user": {...}, "orgs": [{...}], "accessToken": "eyJ..." } }
```

---

## Contacts  `/orgs/:orgId/contacts`

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET    | `/`      | viewer  | List contacts. Query: `?search=&page=&limit=&sortBy=&sortDir=` |
| POST   | `/`      | member  | Create contact |
| GET    | `/:id`   | viewer  | Get contact by ID |
| PUT    | `/:id`   | member  | Update contact |
| DELETE | `/:id`   | admin   | Soft-delete contact |

---

## Invoices  `/orgs/:orgId/invoices`

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET  | `/`             | viewer      | List invoices. Query: `?status=&search=&page=&limit=` |
| POST | `/`             | member      | Create invoice (draft) |
| GET  | `/:id`          | viewer      | Get invoice with line items |
| PUT  | `/:id`          | member      | Update draft invoice |
| POST | `/:id/send`     | member      | Mark as sent, post journal entry |
| POST | `/:id/payment`  | member      | Record payment: `{ amount, method, paymentDate }` |
| POST | `/:id/void`     | accountant  | Void invoice: `{ reason }` |

---

## Chart of Accounts  `/orgs/:orgId/accounts`

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET    | `/`    | viewer     | List all active accounts |
| POST   | `/`    | accountant | Create account |
| GET    | `/:id` | viewer     | Get account with children |
| PUT    | `/:id` | accountant | Update account (non-system only) |
| DELETE | `/:id` | accountant | Soft-delete (no posted transactions) |

---

## Reports  `/orgs/:orgId/reports`

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | `/pl?from=&to=`              | viewer | Profit & Loss |
| GET | `/balance-sheet?asOf=`       | viewer | Balance Sheet |
| GET | `/aged-ar`                   | viewer | Aged Receivables |
| GET | `/dashboard?from=&to=`       | viewer | KPI summary for dashboard |

---

## Error responses

All errors follow this shape:
```json
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "Validation failed",
  "errors": [{ "path": "email", "message": "Invalid email" }]
}
```

Common codes: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `VALIDATION_ERROR`, `INTERNAL_ERROR`

---

## Roles (lowest → highest)
`viewer` → `member` → `accountant` → `admin` → `owner`

Each role can do everything the role below it can.

## Bills  `/orgs/:orgId/bills`

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET  | `/`              | viewer     | List bills. Query: `?status=&search=&page=&limit=` |
| POST | `/`              | member     | Create bill (draft) |
| GET  | `/:id`           | viewer     | Get bill with line items |
| PUT  | `/:id`           | member     | Update draft bill |
| POST | `/:id/approve`   | accountant | Approve for payment |
| POST | `/:id/payment`   | member     | Record payment: `{ amount, method, paymentDate }` |

## Banking  `/orgs/:orgId/banking`

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET   | `/accounts`                                    | viewer | List bank accounts |
| GET   | `/accounts/:accountId/transactions`            | viewer | List transactions. Query: `?status=&page=&limit=` |
| PATCH | `/accounts/:accountId/transactions/:id`        | member | Categorize transaction |
| POST  | `/accounts/:accountId/transactions/import`    | member | Bulk import transactions |

## Payroll  `/orgs/:orgId/payroll`

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET  | `/employees`                | viewer | List employees |
| POST | `/employees`                | admin  | Add employee |
| GET  | `/employees/:id`            | viewer | Get employee |
| PUT  | `/employees/:id`            | admin  | Update employee |
| POST | `/employees/:id/terminate`  | admin  | Terminate: `{ terminationDate }` |
| GET  | `/pay-runs`                 | viewer | List pay runs |
| POST | `/pay-runs`                 | admin  | Create draft: `{ periodStart, periodEnd, payDate }` |
| GET  | `/pay-runs/:id`             | viewer | Get pay run with stubs |
| POST | `/pay-runs/:id/calculate`   | admin  | Calculate gross/taxes/net for all employees |
| POST | `/pay-runs/:id/process`     | admin  | Process and post journal entry |

## Plaid bank feeds  `/orgs/:orgId/plaid`

| Method | Path | Role | Description |
|--------|------|------|-------------|
| POST | `/link-token`          | admin  | Get Plaid Link token for frontend |
| POST | `/exchange`            | admin  | Exchange public token after Link: `{ publicToken, institutionName }` |
| POST | `/sync/:bankAccountId` | member | Sync transactions for one account |
| POST | `/sync-all`            | member | Sync all connected accounts |

## New invoice endpoints

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET  | `/:id/pdf`           | viewer | Stream PDF (add `?download=1` for attachment) |
| POST | `/:id/send`          | member | Send invoice email with PDF + post journal entry |
| POST | `/:id/send-reminder` | member | Email overdue reminder to client |

## Expenses  `/orgs/:orgId/expenses`

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET  | `/`             | viewer     | List expenses. Query: `?status=&search=&page=&limit=` |
| POST | `/`             | member     | Submit expense: `{ date, vendor, category, amount, notes, receiptUrl }` |
| POST | `/:id/approve`  | accountant | Approve expense |
| POST | `/:id/reject`   | accountant | Reject: `{ reason? }` |
