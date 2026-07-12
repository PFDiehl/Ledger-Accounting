-- ─────────────────────────────────────────────────────────
-- 006: Budgets, forecasting, recurring invoices, documents
-- ─────────────────────────────────────────────────────────

-- ── Budgets ──────────────────────────────────────────────

CREATE TYPE budget_period AS ENUM ('monthly', 'quarterly', 'annual');
CREATE TYPE budget_status AS ENUM ('draft', 'active', 'archived');

CREATE TABLE budgets (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name         TEXT          NOT NULL,
  fiscal_year  SMALLINT      NOT NULL,
  period_type  budget_period NOT NULL DEFAULT 'monthly',
  status       budget_status NOT NULL DEFAULT 'draft',
  notes        TEXT,
  created_by   UUID          NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name, fiscal_year)
);

CREATE TABLE budget_lines (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id   UUID          NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  account_id  UUID          NOT NULL REFERENCES accounts(id),
  period      SMALLINT      NOT NULL CHECK (period BETWEEN 1 AND 12),  -- month 1-12
  amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
  notes       TEXT,
  UNIQUE (budget_id, account_id, period)
);

-- ── Recurring invoices ────────────────────────────────────

CREATE TYPE recur_freq   AS ENUM ('weekly', 'monthly', 'quarterly', 'annual');
CREATE TYPE recur_status AS ENUM ('active', 'paused', 'cancelled', 'completed');

CREATE TABLE recurring_invoices (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id       UUID          NOT NULL REFERENCES contacts(id),
  template_data    JSONB         NOT NULL,  -- invoice fields + line items as JSON
  frequency        recur_freq    NOT NULL DEFAULT 'monthly',
  status           recur_status  NOT NULL DEFAULT 'active',
  next_invoice_at  DATE          NOT NULL,
  end_date         DATE,
  auto_send        BOOLEAN       NOT NULL DEFAULT FALSE,
  invoices_created INTEGER       NOT NULL DEFAULT 0,
  max_invoices     INTEGER,       -- NULL = unlimited
  created_by       UUID          NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Documents / attachments (extended) ────────────────────

CREATE TABLE documents (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type  TEXT        NOT NULL,   -- 'invoice' | 'bill' | 'expense' | 'contact'
  entity_id    UUID        NOT NULL,
  filename     TEXT        NOT NULL,
  s3_key       TEXT        NOT NULL,
  mime_type    TEXT        NOT NULL,
  size_bytes   INTEGER     NOT NULL,
  ocr_text     TEXT,                   -- extracted text from OCR
  ocr_status   TEXT        NOT NULL DEFAULT 'pending',  -- pending|processing|done|failed
  uploaded_by  UUID        NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_documents_entity ON documents(entity_type, entity_id);
CREATE INDEX idx_documents_org    ON documents(org_id, created_at DESC);

-- ── Exchange rates ────────────────────────────────────────

CREATE TABLE exchange_rates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  from_currency CHAR(3)     NOT NULL,
  to_currency   CHAR(3)     NOT NULL,
  rate          NUMERIC(16,8) NOT NULL,
  source        TEXT        NOT NULL DEFAULT 'manual',  -- 'manual'|'openexchangerates'
  effective_at  DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, from_currency, to_currency, effective_at)
);

CREATE INDEX idx_rates_lookup ON exchange_rates(org_id, from_currency, to_currency, effective_at DESC);

-- ── Indexes ───────────────────────────────────────────────
CREATE INDEX idx_budgets_org        ON budgets(org_id);
CREATE INDEX idx_budget_lines_bud   ON budget_lines(budget_id);
CREATE INDEX idx_budget_lines_acct  ON budget_lines(account_id);
CREATE INDEX idx_recurring_org      ON recurring_invoices(org_id);
CREATE INDEX idx_recurring_next     ON recurring_invoices(next_invoice_at) WHERE status = 'active';
