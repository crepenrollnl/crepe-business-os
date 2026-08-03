-- Account Role Bindings (Critical Finding #3, Phase C, step 1/2)
-- Run in Supabase SQL editor after sql/055_accounting_chart_of_accounts.sql.
--
-- Physical table for the object specified in docs/ACCOUNTING_DATA_MODEL.md
-- §3.4 ("Maps posting roles to concrete accounts for a company"). Until now
-- only a TypeScript type existed (AccountRoleBinding, src/types/accounting.ts)
-- and a design-doc table (never created in sql/) -- ProductionAccountingContext
-- / SaleAccountingContext both require accountRoleBindings: readonly
-- AccountRoleBinding[] as an input, but there was no live table to read it
-- from (part of the "Accounting Posting never runs" critical finding,
-- 01.08.2026).
--
-- SCHEMA ONLY:
--   account_role_bindings
--
-- Additive, matches the accounts/fiscal_periods RLS pattern (sql/054/055):
--   - authenticated: full access via RLS policy
--   - anon/PUBLIC: explicitly revoked at the table level, in addition to
--     RLS (belt-and-suspenders -- the lesson from the anon-grant critical
--     finding, sql/074, and the sql/076/078/079 REVOKE-in-the-same-migration
--     pattern, applied here even though that lesson was originally about
--     FUNCTION grants, not TABLE grants)
--
-- A role should resolve to exactly one account at a time -- two active
-- bindings for the same role would make posting rule resolution ambiguous
-- (which account does "revenue" mean today?). A partial unique index
-- enforces "at most one active binding per role", the same pattern already
-- used for "at most one open shift" (shifts_one_open_uidx, sql/060).
--
-- Does NOT:
--   - seed any rows (see sql/081_accounting_v1_seed.sql)
--   - create posting_rules / posting_rule_lines tables (posting rules stay
--     TS-side in src/features/accounting/rules/*.ts for now, unchanged)
--   - wire completeSessionAndPostJournal / confirmSaleAndPostJournals into
--     any hook/UI (separate follow-up step)

-- ---------------------------------------------------------------------------
-- account_role_bindings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS account_role_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Matches src/types/accounting.ts PostingAccountRole. Kept as a CHECK
  -- (not an enum type) to stay consistent with how every other enum-like
  -- text column in this project is constrained (accounts.account_type,
  -- shifts.status, sales.status, etc.).
  role text NOT NULL
    CHECK (
      role IN (
        'accounts_receivable',
        'accounts_payable',
        'revenue',
        'cogs',
        'inventory_asset',
        'finished_goods_inventory',
        'vat_output',
        'vat_input',
        'cash',
        'bank',
        'waste_expense',
        'fx_gain',
        'fx_loss',
        'other'
      )
    ),

  account_id uuid NOT NULL
    REFERENCES accounts (id) ON DELETE RESTRICT,

  effective_from date NOT NULL,
  effective_to date,

  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT account_role_bindings_date_range
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

COMMENT ON TABLE account_role_bindings IS
  'Maps a posting role (PostingAccountRole) to a concrete account. At most one active binding per role (account_role_bindings_active_role_uidx).';

-- Enforce a single active binding per role.
CREATE UNIQUE INDEX IF NOT EXISTS account_role_bindings_active_role_uidx
  ON account_role_bindings (role)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS account_role_bindings_account_id_idx
  ON account_role_bindings (account_id);

CREATE INDEX IF NOT EXISTS account_role_bindings_role_idx
  ON account_role_bindings (role);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE account_role_bindings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'account_role_bindings'
      AND policyname = 'account_role_bindings_authenticated_all'
  ) THEN
    CREATE POLICY account_role_bindings_authenticated_all
      ON account_role_bindings
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Explicit table-level REVOKE in addition to RLS -- anon holds its own
-- direct grant on this project independent of PUBLIC membership (see
-- sql/074), and every role is implicitly a member of PUBLIC, so PUBLIC's
-- default table privileges must be revoked explicitly too, not just relied
-- on to be blocked by RLS.
REVOKE ALL ON TABLE account_role_bindings FROM PUBLIC;
REVOKE ALL ON TABLE account_role_bindings FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE account_role_bindings TO authenticated;
