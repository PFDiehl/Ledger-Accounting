-- ─────────────────────────────────────────────
-- 5. CONTACTS (Customers & Vendors)
-- A contact can be a customer, vendor, or both.
-- ─────────────────────────────────────────────

CREATE TYPE contact_type AS ENUM ('customer', 'vendor', 'both');

CREATE TABLE contacts (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID         NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type           contact_type NOT NULL DEFAULT 'customer',
  name           TEXT         NOT NULL,
  email          TEXT,
  phone          TEXT,
  website        TEXT,
  tax_id         TEXT,
  address_line1  TEXT,
  address_line2  TEXT,
  city           TEXT,
  state          TEXT,
  postal_code    TEXT,
  country        CHAR(2)      NOT NULL DEFAULT 'US',
  currency       CHAR(3)      NOT NULL DEFAULT 'USD',
  payment_terms  SMALLINT     NOT NULL DEFAULT 30,       -- days
  notes          TEXT,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 6. INVOICES (Accounts Receivable)
-- ─────────────────────────────────────────────

CREATE TYPE invoice_status AS ENUM (
  'draft', 'sent', 'partial', 'paid', 'overdue', 'void'
);

CREATE TABLE invoices (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id       UUID           NOT NULL REFERENCES contacts(id),
  invoice_number   TEXT           NOT NULL,
  status           invoice_status NOT NULL DEFAULT 'draft',
  issue_date       DATE           NOT NULL,
  due_date         DATE           NOT NULL,
  currency         CHAR(3)        NOT NULL DEFAULT 'USD',
  subtotal         NUMERIC(15,2)  NOT NULL DEFAULT 0,
  tax_amount       NUMERIC(15,2)  NOT NULL DEFAULT 0,
  discount_amount  NUMERIC(15,2)  NOT NULL DEFAULT 0,
  total            NUMERIC(15,2)  NOT NULL DEFAULT 0,
  amount_paid      NUMERIC(15,2)  NOT NULL DEFAULT 0,
  amount_due       NUMERIC(15,2)  GENERATED ALWAYS AS (total - amount_paid) STORED,
  notes            TEXT,
  footer           TEXT,
  sent_at          TIMESTAMPTZ,
  paid_at          TIMESTAMPTZ,
  void_reason      TEXT,
  journal_entry_id UUID           REFERENCES journal_entries(id),
  created_by       UUID           NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, invoice_number)
);

CREATE TABLE invoice_line_items (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id   UUID          NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  description  TEXT          NOT NULL,
  quantity     NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_price   NUMERIC(15,2) NOT NULL,
  discount_pct NUMERIC(5,2)  NOT NULL DEFAULT 0,
  tax_rate     NUMERIC(5,2)  NOT NULL DEFAULT 0,
  amount       NUMERIC(15,2) NOT NULL,                   -- qty * unit_price after discount
  account_id   UUID          REFERENCES accounts(id),    -- revenue account
  sort_order   SMALLINT      NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────
-- 7. BILLS (Accounts Payable)
-- Mirror of invoices, from the vendor side.
-- ─────────────────────────────────────────────

CREATE TYPE bill_status AS ENUM (
  'draft', 'pending', 'partial', 'paid', 'overdue', 'void'
);

CREATE TABLE bills (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id       UUID        NOT NULL REFERENCES contacts(id),
  bill_number      TEXT,                                  -- vendor's invoice number
  status           bill_status NOT NULL DEFAULT 'draft',
  bill_date        DATE        NOT NULL,
  due_date         DATE        NOT NULL,
  currency         CHAR(3)     NOT NULL DEFAULT 'USD',
  subtotal         NUMERIC(15,2) NOT NULL DEFAULT 0,
  tax_amount       NUMERIC(15,2) NOT NULL DEFAULT 0,
  total            NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount_paid      NUMERIC(15,2) NOT NULL DEFAULT 0,
  amount_due       NUMERIC(15,2) GENERATED ALWAYS AS (total - amount_paid) STORED,
  notes            TEXT,
  journal_entry_id UUID        REFERENCES journal_entries(id),
  created_by       UUID        NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bill_line_items (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id      UUID          NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  description  TEXT          NOT NULL,
  quantity     NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_price   NUMERIC(15,2) NOT NULL,
  tax_rate     NUMERIC(5,2)  NOT NULL DEFAULT 0,
  amount       NUMERIC(15,2) NOT NULL,
  account_id   UUID          REFERENCES accounts(id),    -- expense account
  sort_order   SMALLINT      NOT NULL DEFAULT 0
);

-- ─────────────────────────────────────────────
-- 8. PAYMENTS
-- Records money in (invoice payments) and
-- money out (bill payments).
-- ─────────────────────────────────────────────

CREATE TYPE payment_type      AS ENUM ('incoming', 'outgoing');
CREATE TYPE payment_method    AS ENUM (
  'bank_transfer', 'check', 'credit_card',
  'cash', 'stripe', 'paypal', 'other'
);

CREATE TABLE payments (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type             payment_type   NOT NULL,
  contact_id       UUID           REFERENCES contacts(id),
  amount           NUMERIC(15,2)  NOT NULL CHECK (amount > 0),
  currency         CHAR(3)        NOT NULL DEFAULT 'USD',
  payment_date     DATE           NOT NULL,
  method           payment_method NOT NULL DEFAULT 'bank_transfer',
  reference        TEXT,                                  -- check #, transfer ID, etc.
  bank_account_id  UUID           REFERENCES accounts(id),
  notes            TEXT,
  journal_entry_id UUID           REFERENCES journal_entries(id),
  created_by       UUID           NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- Many-to-many: one payment can cover multiple invoices/bills
CREATE TABLE payment_allocations (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id  UUID          NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  invoice_id  UUID          REFERENCES invoices(id),
  bill_id     UUID          REFERENCES bills(id),
  amount      NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  CONSTRAINT one_doc_only CHECK (
    (invoice_id IS NOT NULL AND bill_id IS NULL) OR
    (invoice_id IS NULL     AND bill_id IS NOT NULL)
  )
);
