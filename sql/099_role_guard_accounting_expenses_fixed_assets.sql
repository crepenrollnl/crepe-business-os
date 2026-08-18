-- Role Guard — Tranche 3 (Accounting configuration + Expenses + Fixed Assets)
-- Builds on sql/097 (profiles, get_my_role, require_role) and sql/098
-- (tranche 2 pattern — same two-layer approach, applied here to a
-- different set of modules).
--
-- Two layers, both required:
--   (a) require_role('owner','partner') inside the write RPCs used by
--       Expenses + Fixed Assets, guarding the normal app flow.
--   (b) RLS policies on the underlying tables, because these tables are
--       also writable directly via Supabase-client REST calls, not only
--       through RPC — a role check inside an RPC alone would not stop a
--       direct REST call to the table.
--
-- Scope: Expenses (expense_entries, record_expense), Fixed Assets
-- (fixed_assets, depreciation_entries, register_fixed_asset,
-- run_pending_depreciation), and core Accounting configuration
-- (account_role_bindings, accounts, fiscal_periods) — the tables that
-- control which GL account plays which role and which fiscal periods are
-- open. All six tables currently allow any authenticated user full
-- read/write via a permissive `USING (true)` policy.
--
-- Deliberately NOT touched in this migration: journal_entries,
-- journal_lines, ledger_entries. These are shared with Purchases,
-- Production, and Sales — posting-service.ts writes to them directly
-- from the client (not through a role-checked RPC) for all of those
-- modules. Locking them to owner/partner now would not change today's
-- behavior (only owner/partner accounts exist), but would need to be
-- deliberately revisited before a Seller account is ever created,
-- because Seller is expected to complete Sales, and Sales currently
-- posts journals via that same direct-write path. Left for a dedicated
-- Sales-focused tranche, same reasoning already applied in sql/098 to
-- production_batches / stock_movements / transactions.
--
-- Does NOT:
--   - change any table schema
--   - touch journal_entries / journal_lines / ledger_entries RLS
--   - add role checks to read-only report RPCs (get_btw_report,
--     calculate_purchase_taxes, verify_* functions) — no side effects,
--     deferred

-- ---------------------------------------------------------------------------
-- RLS: restrict writes+reads on Accounting/Expenses/Fixed Assets tables to
-- owner/partner
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS expense_entries_authenticated_all ON expense_entries;
CREATE POLICY expense_entries_owner_partner_all
  ON expense_entries
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS fixed_assets_authenticated_all ON fixed_assets;
CREATE POLICY fixed_assets_owner_partner_all
  ON fixed_assets
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS depreciation_entries_authenticated_all ON depreciation_entries;
CREATE POLICY depreciation_entries_owner_partner_all
  ON depreciation_entries
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS account_role_bindings_authenticated_all ON account_role_bindings;
CREATE POLICY account_role_bindings_owner_partner_all
  ON account_role_bindings
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS accounts_authenticated_all ON accounts;
CREATE POLICY accounts_owner_partner_all
  ON accounts
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS fiscal_periods_authenticated_all ON fiscal_periods;
CREATE POLICY fiscal_periods_owner_partner_all
  ON fiscal_periods
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

-- ---------------------------------------------------------------------------
-- RPC guards: PERFORM require_role('owner', 'partner') inserted as the
-- first statement of each function body. Every other line is byte-for-byte
-- identical to the current repository version — verify this in review.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION record_expense(
  p_account_id uuid,
  p_expense_date date,
  p_net_amount numeric,
  p_vat_amount numeric,
  p_description text,
  p_supplier text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account accounts%ROWTYPE;
  v_period fiscal_periods%ROWTYPE;
  v_cash_account_id uuid;
  v_vat_input_account_id uuid;
  v_net_amount numeric(12, 2);
  v_vat_amount numeric(12, 2);
  v_gross_amount numeric(12, 2);
  v_journal_entry_id uuid;
  v_line_no integer := 0;
  v_line_id uuid;
  v_posting_number text;
  v_expense_entry_id uuid;
  v_now timestamptz := now();
BEGIN
  PERFORM require_role('owner', 'partner');

  -- 0. Basic input validation.
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'Expense account is required.';
  END IF;

  IF p_expense_date IS NULL THEN
    RAISE EXCEPTION 'Expense date is required.';
  END IF;

  IF p_net_amount IS NULL OR p_vat_amount IS NULL THEN
    RAISE EXCEPTION 'Net amount and VAT amount are required (VAT may be 0).';
  END IF;

  IF p_net_amount < 0 OR p_vat_amount < 0 THEN
    RAISE EXCEPTION 'Net amount and VAT amount cannot be negative.';
  END IF;

  IF p_description IS NULL OR length(btrim(p_description)) = 0 THEN
    RAISE EXCEPTION 'Description is required.';
  END IF;

  -- Round once, up front, so the same rounded values are used for the
  -- journal lines and the expense_entries row -- avoids a mismatch between
  -- gross_amount and net_amount + vat_amount from rounding net/vat and the
  -- computed gross separately.
  v_net_amount := round(p_net_amount, 2);
  v_vat_amount := round(p_vat_amount, 2);
  v_gross_amount := v_net_amount + v_vat_amount;

  IF v_gross_amount <= 0 THEN
    RAISE EXCEPTION 'Expense must have a positive total amount.';
  END IF;

  -- 1. Validate the chosen expense account.
  SELECT * INTO v_account
  FROM accounts
  WHERE id = p_account_id;

  IF NOT FOUND
    OR v_account.is_active IS NOT TRUE
    OR v_account.is_postable IS NOT TRUE
    OR v_account.account_type <> 'expense'
  THEN
    RAISE EXCEPTION 'Selected account is not a valid, active expense account.';
  END IF;

  -- 2. Find the open fiscal period covering the expense date.
  SELECT * INTO v_period
  FROM fiscal_periods
  WHERE status = 'open'
    AND p_expense_date BETWEEN start_date AND end_date
  ORDER BY start_date
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No open fiscal period covers this date.';
  END IF;

  -- 3. Resolve Cash/Bank and VAT Input accounts from account_role_bindings --
  -- never hardcode account codes here, so a repointed binding stays correct.
  SELECT account_id INTO v_cash_account_id
  FROM account_role_bindings
  WHERE role = 'cash' AND is_active = true
  LIMIT 1;

  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION 'No active account role binding is configured for cash.';
  END IF;

  IF v_vat_amount > 0 THEN
    SELECT account_id INTO v_vat_input_account_id
    FROM account_role_bindings
    WHERE role = 'vat_input' AND is_active = true
    LIMIT 1;

    IF v_vat_input_account_id IS NULL THEN
      RAISE EXCEPTION 'No active account role binding is configured for VAT input.';
    END IF;
  END IF;

  -- 4. Create the draft journal entry header.
  INSERT INTO journal_entries (
    fiscal_period_id,
    entry_date,
    memo,
    status,
    transaction_currency,
    base_currency,
    exchange_rate
  )
  VALUES (
    v_period.id,
    p_expense_date,
    'Expense: ' || p_description,
    'draft',
    'EUR',
    'EUR',
    1
  )
  RETURNING id INTO v_journal_entry_id;

  -- 5. Journal lines + mirrored ledger entries. Same currency and rate = 1,
  -- so transaction and base amounts are identical.

  -- Line: Dr <expense account> net_amount (skip if net is 0 -- an all-VAT
  -- expense would be unusual but must not insert a zero-amount line, which
  -- journal_lines_has_amount would reject anyway).
  IF v_net_amount > 0 THEN
    v_line_no := v_line_no + 1;

    INSERT INTO journal_lines (
      journal_entry_id, line_no, account_id, description,
      debit_transaction, credit_transaction, debit_base, credit_base
    )
    VALUES (
      v_journal_entry_id, v_line_no, p_account_id, p_description,
      v_net_amount, 0, v_net_amount, 0
    )
    RETURNING id INTO v_line_id;

    INSERT INTO ledger_entries (
      journal_entry_id, journal_line_id, fiscal_period_id, account_id,
      entry_date, debit_base, credit_base, debit_transaction, credit_transaction,
      transaction_currency, base_currency
    )
    VALUES (
      v_journal_entry_id, v_line_id, v_period.id, p_account_id,
      p_expense_date, v_net_amount, 0, v_net_amount, 0,
      'EUR', 'EUR'
    );
  END IF;

  -- Line: Dr VAT Input vat_amount (only when VAT > 0).
  IF v_vat_amount > 0 THEN
    v_line_no := v_line_no + 1;

    INSERT INTO journal_lines (
      journal_entry_id, line_no, account_id, description,
      debit_transaction, credit_transaction, debit_base, credit_base
    )
    VALUES (
      v_journal_entry_id, v_line_no, v_vat_input_account_id, p_description,
      v_vat_amount, 0, v_vat_amount, 0
    )
    RETURNING id INTO v_line_id;

    INSERT INTO ledger_entries (
      journal_entry_id, journal_line_id, fiscal_period_id, account_id,
      entry_date, debit_base, credit_base, debit_transaction, credit_transaction,
      transaction_currency, base_currency
    )
    VALUES (
      v_journal_entry_id, v_line_id, v_period.id, v_vat_input_account_id,
      p_expense_date, v_vat_amount, 0, v_vat_amount, 0,
      'EUR', 'EUR'
    );
  END IF;

  -- Line: Cr Cash/Bank gross_amount.
  v_line_no := v_line_no + 1;

  INSERT INTO journal_lines (
    journal_entry_id, line_no, account_id, description,
    debit_transaction, credit_transaction, debit_base, credit_base
  )
  VALUES (
    v_journal_entry_id, v_line_no, v_cash_account_id, p_description,
    0, v_gross_amount, 0, v_gross_amount
  )
  RETURNING id INTO v_line_id;

  INSERT INTO ledger_entries (
    journal_entry_id, journal_line_id, fiscal_period_id, account_id,
    entry_date, debit_base, credit_base, debit_transaction, credit_transaction,
    transaction_currency, base_currency
  )
  VALUES (
    v_journal_entry_id, v_line_id, v_period.id, v_cash_account_id,
    p_expense_date, 0, v_gross_amount, 0, v_gross_amount,
    'EUR', 'EUR'
  );

  -- 6. Allocate the real posting number and mark the journal posted.
  SELECT allocate_posting_number(p_expense_date) INTO v_posting_number;

  UPDATE journal_entries
  SET
    status = 'posted',
    posting_number = v_posting_number,
    posted_at = v_now
  WHERE id = v_journal_entry_id;

  -- 7. Insert the expense_entries row referencing the posted journal.
  INSERT INTO expense_entries (
    expense_date, account_id, description, supplier,
    net_amount, vat_amount, gross_amount,
    journal_entry_id, created_by
  )
  VALUES (
    p_expense_date, p_account_id, p_description, p_supplier,
    v_net_amount, v_vat_amount, v_gross_amount,
    v_journal_entry_id, auth.uid()
  )
  RETURNING id INTO v_expense_entry_id;

  RETURN jsonb_build_object(
    'expense_entry_id', v_expense_entry_id,
    'journal_entry_id', v_journal_entry_id,
    'posting_number', v_posting_number
  );
END;
$$;

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
  PERFORM require_role('owner', 'partner');

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
  PERFORM require_role('owner', 'partner');

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
