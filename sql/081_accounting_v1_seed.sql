-- Accounting V1 Seed (Critical Finding #3, Phase C, step 2/2)
-- Run in Supabase SQL editor after sql/080_account_role_bindings.sql.
--
-- Seeds the minimum data needed before completeSessionAndPostJournal /
-- confirmSaleAndPostJournals can be wired to a real hook (a separate,
-- later step -- no TS code changes here):
--   1. accounts       -- chart of accounts, 26 rows (agreed with the user)
--   2. fiscal_periods -- one open period covering calendar year 2026
--   3. account_role_bindings -- binds the 9 roles the existing posting
--      rules (src/features/accounting/rules/*.ts) actually reference to
--      the corresponding Group 1 accounts below
--
-- Idempotent: every insert is guarded by a NOT EXISTS check on its natural
-- key (accounts.code, fiscal_periods.name, account_role_bindings.role),
-- safe to re-run -- same idiom as sql/071.
--
-- Account groups (agreed with the user):
--   Group 1 (9 accounts)  -- read by the automatic posting engine via
--     account_role_bindings below
--   Group 2 (14 accounts) -- manual operating-expense entry, no automatic
--     role bound to any of them; Phase D (manual expense entry UI/RPC) is
--     a separate, later step
--   Group 3 (3 accounts)  -- fixed assets / depreciation; Phase E
--     (depreciation logic) is a separate, later step -- these rows are
--     schema only, no depreciation calculation exists anywhere yet
--
-- Does NOT:
--   - create posting_rules / posting_rule_lines tables
--   - implement manual expense entry (Phase D) or depreciation (Phase E)
--   - change any TS code, hook, or UI

-- ---------------------------------------------------------------------------
-- 1. accounts
-- ---------------------------------------------------------------------------

-- Group 1 -- used by the automatic posting engine (bound to roles below).
INSERT INTO accounts (code, name, account_type)
SELECT v.code, v.name, v.account_type
FROM (
  VALUES
    ('1000', 'Cash / Bank', 'asset'),
    ('1010', 'Accounts Receivable', 'asset'),
    ('1100', 'Inventory — Ingredients', 'asset'),
    ('1110', 'Inventory — Finished Goods', 'asset'),
    ('1200', 'VAT Input (recoverable)', 'asset'),
    ('2000', 'Accounts Payable', 'liability'),
    ('2100', 'VAT Output (payable)', 'liability'),
    ('4000', 'Sales Revenue', 'revenue'),
    ('5000', 'Cost of Goods Sold', 'expense')
) AS v(code, name, account_type)
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.code = v.code
);

-- Group 2 -- manual operating-expense entry, no automatic role (Phase D).
INSERT INTO accounts (code, name, account_type)
SELECT v.code, v.name, 'expense'
FROM (
  VALUES
    ('6010', 'Ingredients (off-cycle)'),
    ('6020', 'Packaging'),
    ('6030', 'Cleaning & Hygiene'),
    ('6040', 'Kitchen Tools'),
    ('6050', 'Repairs & Maintenance'),
    ('6060', 'Fuel & Transport'),
    ('6070', 'Parking & Storage'),
    ('6080', 'Market Fees'),
    ('6090', 'Marketing'),
    ('6100', 'Office & Software'),
    ('6110', 'Insurance'),
    ('6120', 'Banking Fees'),
    ('6130', 'Professional Services'),
    ('6140', 'Taxes & Government Fees')
) AS v(code, name)
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.code = v.code
);

-- Group 3 -- fixed assets / depreciation (Phase E). Schema only: no
-- depreciation calculation, schedule, or posting exists yet.
INSERT INTO accounts (code, name, account_type)
SELECT v.code, v.name, v.account_type
FROM (
  VALUES
    ('1500', 'Equipment / Fixed Assets', 'asset'),
    ('1510', 'Accumulated Depreciation', 'contra_asset'),
    ('6200', 'Depreciation Expense', 'expense')
) AS v(code, name, account_type)
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.code = v.code
);

-- ---------------------------------------------------------------------------
-- 2. fiscal_periods
-- ---------------------------------------------------------------------------

INSERT INTO fiscal_periods (name, start_date, end_date, status)
SELECT 'FY2026', '2026-01-01', '2026-12-31', 'open'
WHERE NOT EXISTS (
  SELECT 1 FROM fiscal_periods WHERE name = 'FY2026'
);

-- ---------------------------------------------------------------------------
-- 3. account_role_bindings
-- ---------------------------------------------------------------------------

-- Binds every PostingAccountRole actually referenced by the existing
-- posting rules (src/features/accounting/rules/*.ts) to its Group 1
-- account. Roles never referenced by any rule today (bank, waste_expense,
-- fx_gain, fx_loss, other) are intentionally left unbound.
INSERT INTO account_role_bindings (role, account_id, effective_from, effective_to, is_active)
SELECT v.role, a.id, '2020-01-01', NULL, true
FROM (
  VALUES
    ('revenue', '4000'),
    ('cogs', '5000'),
    ('inventory_asset', '1100'),
    ('finished_goods_inventory', '1110'),
    ('vat_output', '2100'),
    ('vat_input', '1200'),
    ('accounts_payable', '2000'),
    ('accounts_receivable', '1010'),
    ('cash', '1000')
) AS v(role, account_code)
JOIN accounts a ON a.code = v.account_code
WHERE NOT EXISTS (
  SELECT 1
  FROM account_role_bindings b
  WHERE b.role = v.role
    AND b.is_active = true
);
