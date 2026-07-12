-- ─────────────────────────────────────────────
-- 9. BANK ACCOUNTS & TRANSACTIONS
-- Connects to real bank accounts via Plaid
-- or manual CSV import.
-- ─────────────────────────────────────────────

CREATE TYPE bank_account_status AS ENUM ('active', 'inactive', 'error');
CREATE TYPE bank_connection_type AS ENUM ('plaid', 'manual');

CREATE TABLE bank_accounts (
  id                  UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID                 NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ledger_account_id   UUID                 NOT NULL REFERENCES accounts(id),  -- links to CoA
  name                TEXT                 NOT NULL,
  institution_name    TEXT,
  account_type        TEXT,                -- checking, savings, credit_card, etc.
  mask                CHAR(4),             -- last 4 digits
  currency            CHAR(3)              NOT NULL DEFAULT 'USD',
  current_balance     NUMERIC(15,2),
  available_balance   NUMERIC(15,2),
  status              bank_account_status  NOT NULL DEFAULT 'active',
  connection_type     bank_connection_type NOT NULL DEFAULT 'manual',
  plaid_account_id    TEXT,
  plaid_access_token  TEXT,               -- encrypted at rest
  last_synced_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE TYPE txn_status AS ENUM ('unreviewed', 'categorized', 'reconciled', 'excluded');

CREATE TABLE bank_transactions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id  UUID        NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  date             DATE        NOT NULL,
  description      TEXT        NOT NULL,
  amount           NUMERIC(15,2) NOT NULL,               -- negative = debit
  running_balance  NUMERIC(15,2),
  currency         CHAR(3)     NOT NULL DEFAULT 'USD',
  status           txn_status  NOT NULL DEFAULT 'unreviewed',
  plaid_txn_id     TEXT        UNIQUE,                    -- dedup on import
  merchant_name    TEXT,
  category         TEXT,
  account_id       UUID        REFERENCES accounts(id),   -- matched CoA account
  journal_entry_id UUID        REFERENCES journal_entries(id),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 10. BANK RECONCILIATION
-- Periodic reconciliation of bank statement
-- vs ledger balance.
-- ─────────────────────────────────────────────

CREATE TYPE reconciliation_status AS ENUM ('in_progress', 'completed');

CREATE TABLE reconciliations (
  id                    UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID                   NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  bank_account_id       UUID                   NOT NULL REFERENCES bank_accounts(id),
  statement_date        DATE                   NOT NULL,
  statement_balance     NUMERIC(15,2)          NOT NULL,
  opening_balance       NUMERIC(15,2)          NOT NULL,
  status                reconciliation_status  NOT NULL DEFAULT 'in_progress',
  completed_at          TIMESTAMPTZ,
  completed_by          UUID                   REFERENCES users(id),
  created_at            TIMESTAMPTZ            NOT NULL DEFAULT NOW(),
  UNIQUE (bank_account_id, statement_date)
);

CREATE TABLE reconciliation_items (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id  UUID    NOT NULL REFERENCES reconciliations(id) ON DELETE CASCADE,
  bank_transaction_id UUID   REFERENCES bank_transactions(id),
  journal_line_id    UUID    REFERENCES journal_lines(id),
  is_cleared         BOOLEAN NOT NULL DEFAULT FALSE
);

-- ─────────────────────────────────────────────
-- 11. PAYROLL
-- Employee records and pay runs.
-- ─────────────────────────────────────────────

CREATE TYPE employee_status AS ENUM ('active', 'inactive', 'terminated');
CREATE TYPE pay_type        AS ENUM ('salary', 'hourly');
CREATE TYPE pay_frequency   AS ENUM ('weekly', 'biweekly', 'semimonthly', 'monthly');

CREATE TABLE employees (
  id               UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id          UUID            REFERENCES users(id),  -- if they have a login
  first_name       TEXT            NOT NULL,
  last_name        TEXT            NOT NULL,
  email            TEXT,
  phone            TEXT,
  hire_date        DATE            NOT NULL,
  termination_date DATE,
  status           employee_status NOT NULL DEFAULT 'active',
  pay_type         pay_type        NOT NULL DEFAULT 'salary',
  pay_rate         NUMERIC(12,2)   NOT NULL,              -- annual salary or hourly rate
  pay_frequency    pay_frequency   NOT NULL DEFAULT 'biweekly',
  tax_filing_status TEXT,
  federal_allowances SMALLINT     NOT NULL DEFAULT 0,
  state_code       CHAR(2),
  bank_account_number TEXT,                               -- encrypted
  bank_routing_number TEXT,                               -- encrypted
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE TYPE payrun_status AS ENUM ('draft', 'approved', 'processed', 'void');

CREATE TABLE pay_runs (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period_start     DATE          NOT NULL,
  period_end       DATE          NOT NULL,
  pay_date         DATE          NOT NULL,
  status           payrun_status NOT NULL DEFAULT 'draft',
  total_gross      NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_taxes      NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_net        NUMERIC(15,2) NOT NULL DEFAULT 0,
  journal_entry_id UUID          REFERENCES journal_entries(id),
  approved_by      UUID          REFERENCES users(id),
  created_by       UUID          NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE pay_stubs (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_run_id      UUID          NOT NULL REFERENCES pay_runs(id) ON DELETE CASCADE,
  employee_id     UUID          NOT NULL REFERENCES employees(id),
  gross_pay       NUMERIC(12,2) NOT NULL,
  federal_tax     NUMERIC(12,2) NOT NULL DEFAULT 0,
  state_tax       NUMERIC(12,2) NOT NULL DEFAULT 0,
  social_security NUMERIC(12,2) NOT NULL DEFAULT 0,
  medicare        NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_pay         NUMERIC(12,2) NOT NULL,
  ytd_gross       NUMERIC(12,2) NOT NULL DEFAULT 0,
  ytd_taxes       NUMERIC(12,2) NOT NULL DEFAULT 0
);
