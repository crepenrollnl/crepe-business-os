-- Fixed Assets & Straight-Line Depreciation (Critical Finding #3, Phase E, step 1)
-- Run in Supabase SQL editor after sql/081_accounting_v1_seed.sql
-- (accounts 1500/1510/6200 already exist there).
--
-- Design agreed with the user before writing this migration:
--   - Assets (food truck, equipment) were bought BEFORE this system existed.
--     Registering an asset records data only -- it does NOT post a journal
--     (the purchase itself is out of scope, same principle as record_expense
--     never re-posting an already-settled event).
--   - Method: straight-line, monthly, fully to €0 (no residual value).
--   - Not a manual "run this month" button: the page that will read this
--     later calls run_pending_depreciation() on every visit, which catches
--     up ALL months missed since the last visit (not just the current one)
--     in a single call -- the first mechanism of this shape in the project
--     (investigated first: daily-sales-summary-service.ts /
--     daily-profit-summary-service.ts generate a summary once per shift-close
--     EVENT, keyed by shift_id -- that is a different shape, not a
--     multi-period catch-up scan. No existing pattern to copy; this design
--     was worked out fresh with the user and confirmed before implementation).
--   - Period is stored as a date (first-of-month), matching the
--     date_trunc('month', ...) convention already used for monthly buckets
--     in sql/040_sales_trend_analytics.sql (period_start).
--
-- Account resolution: 6200 (Depreciation Expense) and 1510 (Accumulated
-- Depreciation) are resolved by CODE, not through account_role_bindings --
-- unlike cash/vat_input (reused across Sales/Purchases/Production/Expenses),
-- these two accounts are used by exactly this one fixed posting rule, so a
-- new account_role_bindings role for each would be a schema change for a
-- single caller. 1500 (Equipment) is never posted to here (see above).
--
-- Per-asset isolation (agreed change from the original all-or-nothing
-- design): each asset is processed inside its own BEGIN/EXCEPTION sub-block
-- (implicit savepoint -- same mechanism as the shift-race guard in sql/079,
-- applied here for a different purpose). Multi-month catch-up raises the
-- odds of crossing a fiscal-year boundary that was not opened in time
-- (e.g. FY2027 missing) -- with one shared transaction, that would silently
-- block depreciation for every other asset too, on a mechanism that runs
-- automatically with no explicit per-run user confirmation. On any error for
-- one asset (missing fiscal period, etc.), only that asset's work in this
-- call rolls back to its savepoint and is recorded in the returned
-- `skipped` array; other assets still commit normally in the same call.
--
-- Additive only:
--   table:    fixed_assets
--   table:    depreciation_entries
--   function: register_fixed_asset(p_name, p_purchase_date, p_cost,
--             p_useful_life_months) -> jsonb
--   function: run_pending_depreciation() -> jsonb
--
-- Does NOT:
--   - post any journal for asset registration/purchase
--   - change accounts / fiscal_periods / journal_entries / journal_lines /
--     ledger_entries schema, or allocate_posting_number (sql/064)
--   - create any UI, hook, or service (separate follow-up step)

-- ---------------------------------------------------------------------------
-- fixed_assets
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  name text NOT NULL,
  purchase_date date NOT NULL,

  cost numeric(12, 2) NOT NULL
    CHECK (cost > 0),
  useful_life_months integer NOT NULL
    CHECK (useful_life_months > 0),

  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT fixed_assets_name_not_blank
    CHECK (length(btrim(name)) > 0)
);

COMMENT ON TABLE fixed_assets IS
  'Fixed assets bought before this system existed. Registration records data only -- no journal is posted here. Straight-line monthly depreciation is posted by run_pending_depreciation() into depreciation_entries.';

CREATE INDEX IF NOT EXISTS fixed_assets_is_active_idx
  ON fixed_assets (is_active);

CREATE INDEX IF NOT EXISTS fixed_assets_purchase_date_idx
  ON fixed_assets (purchase_date);

ALTER TABLE fixed_assets ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'fixed_assets'
      AND policyname = 'fixed_assets_authenticated_all'
  ) THEN
    CREATE POLICY fixed_assets_authenticated_all
      ON fixed_assets
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- anon holds its own direct grant on this project independent of PUBLIC
-- membership (see sql/074) -- both must be revoked explicitly, same
-- pattern as expense_entries (sql/083).
REVOKE ALL ON TABLE fixed_assets FROM PUBLIC;
REVOKE ALL ON TABLE fixed_assets FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE fixed_assets TO authenticated;

-- ---------------------------------------------------------------------------
-- depreciation_entries
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS depreciation_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  fixed_asset_id uuid NOT NULL
    REFERENCES fixed_assets (id) ON DELETE RESTRICT,

  -- First day of the depreciated month, e.g. '2026-08-01'.
  period date NOT NULL,

  amount numeric(12, 2) NOT NULL
    CHECK (amount > 0),

  journal_entry_id uuid
    REFERENCES journal_entries (id) ON DELETE RESTRICT,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT depreciation_entries_period_is_month_start
    CHECK (period = date_trunc('month', period)::date),

  -- One asset can never be depreciated twice for the same month -- this is
  -- the idempotency guarantee run_pending_depreciation() relies on.
  CONSTRAINT depreciation_entries_asset_period_uidx
    UNIQUE (fixed_asset_id, period)
);

COMMENT ON TABLE depreciation_entries IS
  'Append-only record of monthly straight-line depreciation postings. UNIQUE (fixed_asset_id, period) makes run_pending_depreciation() idempotent per asset per month.';

CREATE INDEX IF NOT EXISTS depreciation_entries_fixed_asset_id_idx
  ON depreciation_entries (fixed_asset_id);

CREATE INDEX IF NOT EXISTS depreciation_entries_period_idx
  ON depreciation_entries (period);

CREATE INDEX IF NOT EXISTS depreciation_entries_journal_entry_id_idx
  ON depreciation_entries (journal_entry_id);

ALTER TABLE depreciation_entries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'depreciation_entries'
      AND policyname = 'depreciation_entries_authenticated_all'
  ) THEN
    CREATE POLICY depreciation_entries_authenticated_all
      ON depreciation_entries
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE depreciation_entries FROM PUBLIC;
REVOKE ALL ON TABLE depreciation_entries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE depreciation_entries TO authenticated;

-- ---------------------------------------------------------------------------
-- register_fixed_asset
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION register_fixed_asset(
  p_name text,
  p_purchase_date date,
  p_cost numeric,
  p_useful_life_months integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_asset fixed_assets%ROWTYPE;
BEGIN
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'Asset name is required.';
  END IF;

  IF p_purchase_date IS NULL THEN
    RAISE EXCEPTION 'Purchase date is required.';
  END IF;

  IF p_cost IS NULL OR p_cost <= 0 THEN
    RAISE EXCEPTION 'Cost must be greater than 0.';
  END IF;

  IF p_useful_life_months IS NULL OR p_useful_life_months <= 0 THEN
    RAISE EXCEPTION 'Useful life (months) must be greater than 0.';
  END IF;

  -- No journal posted here -- the asset was already bought before this
  -- system existed; only depreciation (run_pending_depreciation) posts.
  INSERT INTO fixed_assets (name, purchase_date, cost, useful_life_months)
  VALUES (btrim(p_name), p_purchase_date, round(p_cost, 2), p_useful_life_months)
  RETURNING * INTO v_asset;

  RETURN to_jsonb(v_asset);
END;
$$;

COMMENT ON FUNCTION register_fixed_asset(text, date, numeric, integer) IS
  'Register a fixed asset already owned before this system existed. Records data only -- posts no journal entry.';

REVOKE ALL ON FUNCTION register_fixed_asset(text, date, numeric, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION register_fixed_asset(text, date, numeric, integer) FROM anon;
GRANT EXECUTE ON FUNCTION register_fixed_asset(text, date, numeric, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- run_pending_depreciation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION run_pending_depreciation()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_depreciation_expense_account_id uuid;
  v_accumulated_depreciation_account_id uuid;

  v_asset fixed_assets%ROWTYPE;
  v_already_depreciated numeric(12, 2);
  v_months_elapsed integer;
  v_eligible_periods integer;

  v_period_index integer;
  v_period date;
  v_amount numeric(12, 2);

  v_fiscal_period_id uuid;
  v_journal_entry_id uuid;
  v_line_id uuid;
  v_posting_number text;

  v_asset_entries_created integer;
  v_asset_amount numeric(12, 2);

  v_entries_created integer := 0;
  v_total_amount numeric(12, 2) := 0;
  v_details jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
BEGIN
  -- Resolve the two posting accounts once, up front. 1500 (Equipment) is
  -- never posted to here -- see file header.
  SELECT id INTO v_depreciation_expense_account_id
  FROM accounts
  WHERE code = '6200' AND is_active = true AND is_postable = true;

  IF v_depreciation_expense_account_id IS NULL THEN
    RAISE EXCEPTION 'Depreciation Expense account (6200) is missing or inactive.';
  END IF;

  SELECT id INTO v_accumulated_depreciation_account_id
  FROM accounts
  WHERE code = '1510' AND is_active = true AND is_postable = true;

  IF v_accumulated_depreciation_account_id IS NULL THEN
    RAISE EXCEPTION 'Accumulated Depreciation account (1510) is missing or inactive.';
  END IF;

  -- Lock each asset row as we go -- serializes concurrent
  -- run_pending_depreciation() calls at the asset level (a second call
  -- blocks until the first commits, then correctly sees the periods
  -- already inserted and skips them). Locked for the whole outer
  -- transaction regardless of the per-asset savepoint below.
  FOR v_asset IN
    SELECT * FROM fixed_assets WHERE is_active = true ORDER BY purchase_date, id
    FOR UPDATE
  LOOP
    -- Per-asset isolation: an error for this asset (e.g. a missing open
    -- fiscal period for one of its catch-up months) rolls back only this
    -- asset's work in this call and is recorded in `skipped` -- it must
    -- not block depreciation for any other asset in the same call.
    BEGIN
      SELECT COALESCE(SUM(amount), 0) INTO v_already_depreciated
      FROM depreciation_entries
      WHERE fixed_asset_id = v_asset.id;

      -- Explicit skip on top of the useful_life_months cap below --
      -- belt-and-suspenders against rounding/manual-edit edge cases.
      IF v_already_depreciated >= v_asset.cost THEN
        CONTINUE;
      END IF;

      v_months_elapsed :=
        (EXTRACT(YEAR FROM CURRENT_DATE)::integer
          - EXTRACT(YEAR FROM v_asset.purchase_date)::integer) * 12
        + (EXTRACT(MONTH FROM CURRENT_DATE)::integer
          - EXTRACT(MONTH FROM v_asset.purchase_date)::integer)
        + 1;

      v_eligible_periods := LEAST(v_months_elapsed, v_asset.useful_life_months);

      v_asset_entries_created := 0;
      v_asset_amount := 0;

      FOR v_period_index IN 1..v_eligible_periods LOOP
        v_period := (
          date_trunc('month', v_asset.purchase_date)
          + make_interval(months => v_period_index - 1)
        )::date;

        IF EXISTS (
          SELECT 1 FROM depreciation_entries
          WHERE fixed_asset_id = v_asset.id AND period = v_period
        ) THEN
          CONTINUE;
        END IF;

        -- Last period of the asset's useful life (not the last period
        -- processed in this call) takes the rounding remainder, so the
        -- total across all periods equals cost exactly.
        IF v_period_index = v_asset.useful_life_months THEN
          SELECT v_asset.cost - COALESCE(SUM(amount), 0) INTO v_amount
          FROM depreciation_entries
          WHERE fixed_asset_id = v_asset.id;
        ELSE
          v_amount := round(v_asset.cost / v_asset.useful_life_months, 2);
        END IF;

        SELECT id INTO v_fiscal_period_id
        FROM fiscal_periods
        WHERE status = 'open'
          AND v_period BETWEEN start_date AND end_date
        ORDER BY start_date
        LIMIT 1;

        IF v_fiscal_period_id IS NULL THEN
          RAISE EXCEPTION 'No open fiscal period covers %.', v_period;
        END IF;

        INSERT INTO journal_entries (
          fiscal_period_id, entry_date, memo, status,
          transaction_currency, base_currency, exchange_rate
        )
        VALUES (
          v_fiscal_period_id, v_period,
          'Depreciation: ' || v_asset.name || ' (' || to_char(v_period, 'YYYY-MM') || ')',
          'draft', 'EUR', 'EUR', 1
        )
        RETURNING id INTO v_journal_entry_id;

        -- Dr Depreciation Expense (6200).
        INSERT INTO journal_lines (
          journal_entry_id, line_no, account_id, description,
          debit_transaction, credit_transaction, debit_base, credit_base
        )
        VALUES (
          v_journal_entry_id, 1, v_depreciation_expense_account_id, v_asset.name,
          v_amount, 0, v_amount, 0
        )
        RETURNING id INTO v_line_id;

        INSERT INTO ledger_entries (
          journal_entry_id, journal_line_id, fiscal_period_id, account_id,
          entry_date, debit_base, credit_base, debit_transaction, credit_transaction,
          transaction_currency, base_currency
        )
        VALUES (
          v_journal_entry_id, v_line_id, v_fiscal_period_id,
          v_depreciation_expense_account_id, v_period,
          v_amount, 0, v_amount, 0, 'EUR', 'EUR'
        );

        -- Cr Accumulated Depreciation (1510).
        INSERT INTO journal_lines (
          journal_entry_id, line_no, account_id, description,
          debit_transaction, credit_transaction, debit_base, credit_base
        )
        VALUES (
          v_journal_entry_id, 2, v_accumulated_depreciation_account_id, v_asset.name,
          0, v_amount, 0, v_amount
        )
        RETURNING id INTO v_line_id;

        INSERT INTO ledger_entries (
          journal_entry_id, journal_line_id, fiscal_period_id, account_id,
          entry_date, debit_base, credit_base, debit_transaction, credit_transaction,
          transaction_currency, base_currency
        )
        VALUES (
          v_journal_entry_id, v_line_id, v_fiscal_period_id,
          v_accumulated_depreciation_account_id, v_period,
          0, v_amount, 0, v_amount, 'EUR', 'EUR'
        );

        SELECT allocate_posting_number(v_period) INTO v_posting_number;

        UPDATE journal_entries
        SET status = 'posted', posting_number = v_posting_number, posted_at = now()
        WHERE id = v_journal_entry_id;

        INSERT INTO depreciation_entries (fixed_asset_id, period, amount, journal_entry_id)
        VALUES (v_asset.id, v_period, v_amount, v_journal_entry_id);

        v_asset_entries_created := v_asset_entries_created + 1;
        v_asset_amount := v_asset_amount + v_amount;

        v_details := v_details || jsonb_build_object(
          'fixed_asset_id', v_asset.id,
          'period', v_period,
          'amount', v_amount,
          'posting_number', v_posting_number
        );
      END LOOP;

      v_entries_created := v_entries_created + v_asset_entries_created;
      v_total_amount := v_total_amount + v_asset_amount;
    EXCEPTION WHEN OTHERS THEN
      -- Roll back only this asset's work in this call (implicit savepoint)
      -- and record why -- other assets already processed in this loop keep
      -- their commits; see file header for the rationale.
      v_skipped := v_skipped || jsonb_build_object(
        'fixed_asset_id', v_asset.id,
        'reason', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'entries_created', v_entries_created,
    'total_amount', v_total_amount,
    'details', v_details,
    'skipped', v_skipped
  );
END;
$$;

COMMENT ON FUNCTION run_pending_depreciation() IS
  'Catch up all missed monthly straight-line depreciation periods for every active fixed asset in one call. Each asset is isolated in its own BEGIN/EXCEPTION sub-block -- a failure for one asset (e.g. a missing open fiscal period) is recorded in the returned skipped array and does not block any other asset in the same call.';

REVOKE ALL ON FUNCTION run_pending_depreciation() FROM PUBLIC;
REVOKE ALL ON FUNCTION run_pending_depreciation() FROM anon;
GRANT EXECUTE ON FUNCTION run_pending_depreciation() TO authenticated;
