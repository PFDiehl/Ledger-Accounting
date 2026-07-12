# Ledger — Database Schema

## Files

| File | Contents |
|------|----------|
| `001_core.sql` | Organizations, users, roles, chart of accounts, journal entries & lines |
| `002_ar_ap.sql` | Contacts, invoices, bills, payments, payment allocations |
| `003_banking_payroll.sql` | Bank accounts, transactions, reconciliation, employees, pay runs |
| `004_aux_and_indexes.sql` | Tax rates, attachments, audit log, all indexes |
| `005_seed_and_views.sql` | Default chart of accounts seed function, account_balances view, aged_receivables view |
| `schema.prisma` | Prisma schema for use in the Node.js backend |

## How to run

```bash
# Create the database
createdb ledger_dev

# Apply all migrations in order
psql ledger_dev -f 001_core.sql
psql ledger_dev -f 002_ar_ap.sql
psql ledger_dev -f 003_banking_payroll.sql
psql ledger_dev -f 004_aux_and_indexes.sql
psql ledger_dev -f 005_seed_and_views.sql

# Seed a new org's chart of accounts
psql ledger_dev -c "SELECT seed_chart_of_accounts('<your-org-uuid>'::uuid);"
```

## Key design decisions

### Multi-tenancy
Every business table has an `org_id` column. All queries must include `WHERE org_id = $orgId`.
Row-level security (RLS) can be enabled in Postgres to enforce this at the DB layer.

### Double-entry bookkeeping
- `journal_entries` is the parent record (date, description, status)
- `journal_lines` holds the individual debits and credits
- A database trigger (`check_journal_balanced`) rejects any entry where debits ≠ credits

### Human-readable IDs
Invoices, bills, and journal entries get sequential numbers (INV-1001, JE-0042) via the
`sequences` table and `next_sequence()` function. This is atomic — no duplicates under load.

### Audit log
The `audit_log` table records every INSERT/UPDATE/DELETE on financial tables as JSONB
snapshots. It is append-only and partitioned by year for performance. Never delete from it.

### Immutable financials
Posted journal entries should never be edited. To reverse a posted entry, create a new
reversing journal entry. The `void` status marks an entry as cancelled but preserves the
original data.

## Table relationships

```
organizations
  ├── org_members  → users
  ├── accounts (chart of accounts)
  ├── contacts (customers & vendors)
  ├── invoices → invoice_line_items
  │             → payment_allocations ← payments
  ├── bills    → bill_line_items
  │             → payment_allocations ← payments
  ├── journal_entries → journal_lines → accounts
  ├── bank_accounts   → bank_transactions
  ├── reconciliations → reconciliation_items
  ├── employees → pay_runs → pay_stubs
  ├── tax_rates
  ├── attachments
  └── sequences
```
