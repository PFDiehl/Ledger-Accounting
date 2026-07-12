-- ─────────────────────────────────────────────
-- SEED: Default Chart of Accounts
-- Run this after creating a new organization.
-- Call with the new org's UUID.
-- ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION seed_chart_of_accounts(p_org_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO accounts (org_id, code, name, type, subtype, normal_balance, is_system) VALUES

  -- ── ASSETS (1xxx) ──
  (p_org_id, '1000', 'Current Assets',              'asset', 'other_asset',        'debit',  TRUE),
  (p_org_id, '1010', 'Checking Account',             'asset', 'bank',               'debit',  TRUE),
  (p_org_id, '1020', 'Savings Account',              'asset', 'bank',               'debit',  TRUE),
  (p_org_id, '1030', 'Petty Cash',                   'asset', 'cash',               'debit',  FALSE),
  (p_org_id, '1100', 'Accounts Receivable',          'asset', 'accounts_receivable','debit',  TRUE),
  (p_org_id, '1200', 'Inventory',                    'asset', 'inventory',          'debit',  FALSE),
  (p_org_id, '1300', 'Prepaid Expenses',             'asset', 'prepaid_expense',    'debit',  FALSE),
  (p_org_id, '1500', 'Fixed Assets',                 'asset', 'other_asset',        'debit',  FALSE),
  (p_org_id, '1510', 'Equipment',                    'asset', 'fixed_asset',        'debit',  FALSE),
  (p_org_id, '1520', 'Accumulated Depreciation',     'asset', 'fixed_asset',        'credit', FALSE),

  -- ── LIABILITIES (2xxx) ──
  (p_org_id, '2000', 'Current Liabilities',          'liability', 'other_liability', 'credit', TRUE),
  (p_org_id, '2100', 'Accounts Payable',             'liability', 'accounts_payable','credit', TRUE),
  (p_org_id, '2200', 'Credit Card Payable',          'liability', 'credit_card',     'credit', FALSE),
  (p_org_id, '2300', 'Sales Tax Payable',            'liability', 'tax_payable',     'credit', TRUE),
  (p_org_id, '2400', 'Payroll Tax Payable',          'liability', 'tax_payable',     'credit', FALSE),
  (p_org_id, '2500', 'Accrued Liabilities',          'liability', 'other_liability', 'credit', FALSE),
  (p_org_id, '2700', 'Long-Term Debt',               'liability', 'long_term_loan',  'credit', FALSE),

  -- ── EQUITY (3xxx) ──
  (p_org_id, '3000', 'Owner''s Equity',              'equity', 'owners_equity',     'credit', TRUE),
  (p_org_id, '3100', 'Owner''s Drawings',            'equity', 'owners_equity',     'debit',  FALSE),
  (p_org_id, '3200', 'Retained Earnings',            'equity', 'retained_earnings', 'credit', TRUE),

  -- ── REVENUE (4xxx) ──
  (p_org_id, '4000', 'Revenue',                      'revenue', 'operating_revenue','credit', TRUE),
  (p_org_id, '4010', 'Sales',                        'revenue', 'operating_revenue','credit', TRUE),
  (p_org_id, '4020', 'Services',                     'revenue', 'operating_revenue','credit', FALSE),
  (p_org_id, '4900', 'Other Income',                 'revenue', 'other_revenue',    'credit', FALSE),

  -- ── EXPENSES (5xxx–6xxx) ──
  (p_org_id, '5000', 'Cost of Goods Sold',           'expense', 'cost_of_goods_sold','debit', FALSE),
  (p_org_id, '6000', 'Operating Expenses',           'expense', 'other_expense',    'debit',  FALSE),
  (p_org_id, '6010', 'Salaries & Wages',             'expense', 'payroll_expense',  'debit',  FALSE),
  (p_org_id, '6020', 'Payroll Taxes',                'expense', 'payroll_expense',  'debit',  FALSE),
  (p_org_id, '6030', 'Rent',                         'expense', 'rent_expense',     'debit',  FALSE),
  (p_org_id, '6040', 'Utilities',                    'expense', 'utilities_expense','debit',  FALSE),
  (p_org_id, '6050', 'Internet & Phone',             'expense', 'utilities_expense','debit',  FALSE),
  (p_org_id, '6060', 'Software & Subscriptions',     'expense', 'other_expense',    'debit',  FALSE),
  (p_org_id, '6070', 'Office Supplies',              'expense', 'other_expense',    'debit',  FALSE),
  (p_org_id, '6080', 'Travel & Entertainment',       'expense', 'other_expense',    'debit',  FALSE),
  (p_org_id, '6090', 'Marketing & Advertising',      'expense', 'marketing_expense','debit',  FALSE),
  (p_org_id, '6100', 'Professional Services',        'expense', 'other_expense',    'debit',  FALSE),
  (p_org_id, '6110', 'Insurance',                    'expense', 'other_expense',    'debit',  FALSE),
  (p_org_id, '6120', 'Depreciation',                 'expense', 'other_expense',    'debit',  FALSE),
  (p_org_id, '6900', 'Bank Fees & Charges',          'expense', 'other_expense',    'debit',  FALSE),
  (p_org_id, '6910', 'Interest Expense',             'expense', 'other_expense',    'debit',  FALSE);

  -- Seed sequences for this org
  INSERT INTO sequences (org_id, name, prefix, next_val) VALUES
    (p_org_id, 'invoice', 'INV-', 1001),
    (p_org_id, 'bill',    'BILL-', 1001),
    (p_org_id, 'journal', 'JE-',   1);

END;
$$;

-- ─────────────────────────────────────────────
-- VIEWS: Common report queries
-- ─────────────────────────────────────────────

-- Account balances (summed from journal lines)
CREATE VIEW account_balances AS
SELECT
  a.org_id,
  a.id         AS account_id,
  a.code,
  a.name,
  a.type,
  a.subtype,
  a.normal_balance,
  COALESCE(SUM(jl.debit),  0) AS total_debits,
  COALESCE(SUM(jl.credit), 0) AS total_credits,
  CASE a.normal_balance
    WHEN 'debit'  THEN COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0)
    WHEN 'credit' THEN COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
  END AS balance
FROM accounts a
LEFT JOIN journal_lines jl ON jl.account_id = a.id
LEFT JOIN journal_entries je ON je.id = jl.entry_id AND je.status = 'posted'
WHERE a.is_active = TRUE
GROUP BY a.org_id, a.id, a.code, a.name, a.type, a.subtype, a.normal_balance;

-- Aged AR summary
CREATE VIEW aged_receivables AS
SELECT
  i.org_id,
  c.name                                          AS client,
  i.invoice_number,
  i.due_date,
  i.amount_due,
  CURRENT_DATE - i.due_date                       AS days_overdue,
  CASE
    WHEN CURRENT_DATE <= i.due_date              THEN 'current'
    WHEN CURRENT_DATE - i.due_date <= 30         THEN '1_30'
    WHEN CURRENT_DATE - i.due_date <= 60         THEN '31_60'
    WHEN CURRENT_DATE - i.due_date <= 90         THEN '61_90'
    ELSE                                              'over_90'
  END                                             AS aging_bucket
FROM invoices i
JOIN contacts c ON c.id = i.contact_id
WHERE i.status NOT IN ('paid', 'void', 'draft')
  AND i.amount_due > 0;
