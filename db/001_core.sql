-- ─────────────────────────────────────────────
-- LEDGER — PostgreSQL Schema
-- Multi-tenant, double-entry bookkeeping
-- ─────────────────────────────────────────────

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─────────────────────────────────────────────
-- 1. ORGANIZATIONS (tenants)
-- Every row in every business table is scoped
-- to an org_id. This is the isolation boundary.
-- ─────────────────────────────────────────────

CREATE TABLE organizations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT        NOT NULL,
  slug            TEXT        NOT NULL UNIQUE,          -- used in URLs
  email           TEXT        NOT NULL,
  phone           TEXT,
  address_line1   TEXT,
  address_line2   TEXT,
  city            TEXT,
  state           TEXT,
  postal_code     TEXT,
  country         CHAR(2)     NOT NULL DEFAULT 'US',
  currency        CHAR(3)     NOT NULL DEFAULT 'USD',   -- ISO 4217
  fiscal_year_end SMALLINT    NOT NULL DEFAULT 12,      -- month (1–12)
  tax_id          TEXT,                                  -- EIN / VAT etc.
  logo_url        TEXT,
  timezone        TEXT        NOT NULL DEFAULT 'America/New_York',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 2. USERS & MEMBERSHIPS
-- Users belong to one or more orgs with a role.
-- ─────────────────────────────────────────────

CREATE TYPE user_status AS ENUM ('active', 'inactive', 'invited');

CREATE TABLE users (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT        NOT NULL UNIQUE,
  full_name       TEXT        NOT NULL,
  avatar_url      TEXT,
  password_hash   TEXT,                                  -- null for SSO-only users
  status          user_status NOT NULL DEFAULT 'active',
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE org_role AS ENUM ('owner', 'admin', 'accountant', 'member', 'viewer');

CREATE TABLE org_members (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       org_role    NOT NULL DEFAULT 'member',
  invited_by UUID        REFERENCES users(id),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

-- ─────────────────────────────────────────────
-- 3. CHART OF ACCOUNTS
-- Standard double-entry account types.
-- Supports user-defined sub-accounts.
-- ─────────────────────────────────────────────

CREATE TYPE account_type AS ENUM (
  'asset', 'liability', 'equity', 'revenue', 'expense'
);

CREATE TYPE account_subtype AS ENUM (
  -- Assets
  'cash', 'bank', 'accounts_receivable', 'inventory',
  'prepaid_expense', 'fixed_asset', 'other_asset',
  -- Liabilities
  'accounts_payable', 'credit_card', 'short_term_loan',
  'long_term_loan', 'tax_payable', 'other_liability',
  -- Equity
  'owners_equity', 'retained_earnings', 'common_stock',
  -- Revenue
  'operating_revenue', 'other_revenue',
  -- Expense
  'cost_of_goods_sold', 'payroll_expense', 'rent_expense',
  'utilities_expense', 'marketing_expense', 'other_expense'
);

CREATE TABLE accounts (
  id            UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID            NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_id     UUID            REFERENCES accounts(id),              -- sub-accounts
  code          TEXT            NOT NULL,                             -- e.g. "1010"
  name          TEXT            NOT NULL,
  type          account_type    NOT NULL,
  subtype       account_subtype NOT NULL,
  description   TEXT,
  is_active     BOOLEAN         NOT NULL DEFAULT TRUE,
  is_system     BOOLEAN         NOT NULL DEFAULT FALSE,               -- built-in, non-deletable
  normal_balance CHAR(6)        NOT NULL CHECK (normal_balance IN ('debit','credit')),
  created_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, code)
);

-- ─────────────────────────────────────────────
-- 4. GENERAL LEDGER — JOURNAL ENTRIES
-- The heart of the system. All financial
-- activity posts here as debits and credits.
-- ─────────────────────────────────────────────

CREATE TYPE journal_status AS ENUM ('draft', 'posted', 'void');
CREATE TYPE journal_source AS ENUM (
  'manual', 'invoice', 'bill', 'payment',
  'bank_import', 'payroll', 'adjustment'
);

CREATE TABLE journal_entries (
  id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entry_number   TEXT           NOT NULL,                  -- e.g. "JE-0042"
  date           DATE           NOT NULL,
  description    TEXT           NOT NULL,
  source         journal_source NOT NULL DEFAULT 'manual',
  source_id      UUID,                                     -- FK to invoice/bill/etc.
  status         journal_status NOT NULL DEFAULT 'draft',
  created_by     UUID           NOT NULL REFERENCES users(id),
  posted_at      TIMESTAMPTZ,
  void_reason    TEXT,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, entry_number)
);

CREATE TABLE journal_lines (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    UUID        NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_id  UUID        NOT NULL REFERENCES accounts(id),
  description TEXT,
  debit       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit      NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  -- exactly one of debit/credit must be non-zero
  CONSTRAINT one_side_only CHECK (
    (debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)
  )
);

-- Enforce balanced entries (debits = credits) via a trigger
CREATE OR REPLACE FUNCTION check_journal_balanced()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  total_debit  NUMERIC;
  total_credit NUMERIC;
BEGIN
  SELECT
    COALESCE(SUM(debit),  0),
    COALESCE(SUM(credit), 0)
  INTO total_debit, total_credit
  FROM journal_lines
  WHERE entry_id = COALESCE(NEW.entry_id, OLD.entry_id);

  IF total_debit <> total_credit THEN
    RAISE EXCEPTION 'Journal entry is not balanced: debits=% credits=%',
      total_debit, total_credit;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER journal_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_balanced();
