-- ─────────────────────────────────────────────
-- 12. TAX RATES
-- Reusable tax rates applied to invoice/bill
-- line items.
-- ─────────────────────────────────────────────

CREATE TABLE tax_rates (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT          NOT NULL,                    -- e.g. "CA Sales Tax"
  rate        NUMERIC(6,4)  NOT NULL CHECK (rate >= 0 AND rate <= 1),
  description TEXT,
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);

-- ─────────────────────────────────────────────
-- 13. ATTACHMENTS
-- File references for invoices, bills,
-- receipts, and other documents.
-- ─────────────────────────────────────────────

CREATE TYPE attachment_entity AS ENUM (
  'invoice', 'bill', 'payment', 'journal_entry',
  'bank_transaction', 'employee'
);

CREATE TABLE attachments (
  id           UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID               NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type  attachment_entity  NOT NULL,
  entity_id    UUID               NOT NULL,
  filename     TEXT               NOT NULL,
  s3_key       TEXT               NOT NULL,              -- path in S3/object storage
  mime_type    TEXT               NOT NULL,
  size_bytes   INTEGER            NOT NULL,
  uploaded_by  UUID               NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 14. AUDIT LOG
-- Immutable record of every change to any
-- financial record. Required for compliance.
-- Never update or delete rows in this table.
-- ─────────────────────────────────────────────

CREATE TABLE audit_log (
  id          BIGSERIAL    PRIMARY KEY,
  org_id      UUID         NOT NULL,
  user_id     UUID,
  action      TEXT         NOT NULL,                     -- INSERT, UPDATE, DELETE
  table_name  TEXT         NOT NULL,
  record_id   UUID         NOT NULL,
  old_data    JSONB,
  new_data    JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Partition by year (create new partition each Jan 1)
CREATE TABLE audit_log_2026
  PARTITION OF audit_log
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

CREATE TABLE audit_log_2027
  PARTITION OF audit_log
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

-- Generic audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger_fn()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log (org_id, action, table_name, record_id, old_data, new_data)
  VALUES (
    COALESCE(NEW.org_id, OLD.org_id),
    TG_OP,
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Apply audit trigger to all financial tables
CREATE TRIGGER audit_journal_entries
  AFTER INSERT OR UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_invoices
  AFTER INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_bills
  AFTER INSERT OR UPDATE OR DELETE ON bills
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_payments
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

CREATE TRIGGER audit_pay_runs
  AFTER INSERT OR UPDATE OR DELETE ON pay_runs
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

-- ─────────────────────────────────────────────
-- 15. SEQUENCES (for human-readable numbers)
-- ─────────────────────────────────────────────

CREATE TABLE sequences (
  org_id  UUID  NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name    TEXT  NOT NULL,                                -- 'invoice', 'bill', 'journal'
  prefix  TEXT  NOT NULL DEFAULT '',
  next_val INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, name)
);

-- Function to get next sequence value atomically
CREATE OR REPLACE FUNCTION next_sequence(p_org_id UUID, p_name TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  rec sequences%ROWTYPE;
BEGIN
  UPDATE sequences
  SET next_val = next_val + 1
  WHERE org_id = p_org_id AND name = p_name
  RETURNING * INTO rec;

  RETURN rec.prefix || LPAD((rec.next_val - 1)::TEXT, 4, '0');
END;
$$;

-- ─────────────────────────────────────────────
-- 16. INDEXES
-- Performance indexes for the most common
-- query patterns.
-- ─────────────────────────────────────────────

-- Multi-tenant isolation (every query filters by org_id)
CREATE INDEX idx_accounts_org            ON accounts(org_id);
CREATE INDEX idx_contacts_org            ON contacts(org_id);
CREATE INDEX idx_invoices_org            ON invoices(org_id);
CREATE INDEX idx_invoices_contact        ON invoices(contact_id);
CREATE INDEX idx_invoices_status         ON invoices(org_id, status);
CREATE INDEX idx_invoices_due            ON invoices(org_id, due_date) WHERE status NOT IN ('paid','void');
CREATE INDEX idx_bills_org               ON bills(org_id);
CREATE INDEX idx_bills_status            ON bills(org_id, status);
CREATE INDEX idx_bills_due               ON bills(org_id, due_date) WHERE status NOT IN ('paid','void');
CREATE INDEX idx_payments_org            ON payments(org_id);
CREATE INDEX idx_journal_entries_org     ON journal_entries(org_id);
CREATE INDEX idx_journal_entries_date    ON journal_entries(org_id, date);
CREATE INDEX idx_journal_entries_source  ON journal_entries(source, source_id);
CREATE INDEX idx_journal_lines_entry     ON journal_lines(entry_id);
CREATE INDEX idx_journal_lines_account   ON journal_lines(account_id);
CREATE INDEX idx_bank_transactions_org   ON bank_transactions(org_id);
CREATE INDEX idx_bank_transactions_acct  ON bank_transactions(bank_account_id, date DESC);
CREATE INDEX idx_bank_transactions_status ON bank_transactions(org_id, status);
CREATE INDEX idx_audit_log_org           ON audit_log(org_id, created_at DESC);
CREATE INDEX idx_audit_log_record        ON audit_log(table_name, record_id);
CREATE INDEX idx_employees_org           ON employees(org_id);
CREATE INDEX idx_pay_stubs_run           ON pay_stubs(pay_run_id);

-- Full-text search on contacts and invoices
CREATE INDEX idx_contacts_search ON contacts USING gin(
  to_tsvector('english', name || ' ' || COALESCE(email,''))
);
