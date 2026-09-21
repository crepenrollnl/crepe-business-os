-- SQL test: get_profit_and_loss (sql/121).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1. Do not run against shared live
-- dev as a CI job (E2E already uses that project over REST).
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/get_profit_and_loss.sql
-- (exit 0). Bootstrap: tests/sql/bootstrap/profit_and_loss.list
-- (applied by the preceding sql-profit-and-loss.yml step in CI).
--
-- Scenarios:
--   A — confirmed sale + matching ledger 4000/5000: revenue/cogs
--       reconciliation mismatch = false
--   B — period with no operational or ledger rows: all zeros,
--       mismatch = false
--   C — confirmed sale with no ledger_entries: sales_revenue.mismatch = true
--   D — sale status = 'paid' with matching ledger 4000: operational
--       revenue still counts it, mismatch = false
--   E — confirmed sale whose COGS is only stock_movements (sql/120
--       assembly ingredient_id branch: sale_out / reference_type sale /
--       reference_id = sale_line.id). No fgbc rows. mismatch = false
--
-- Actor: stub_owner_profile.sql (applied after sql/097). JWT GUCs match
-- prelude_auth.sql's auth.uid(). Dummy production_batches are inserted
-- directly (same shortcut as tests/sql/confirm_sale_zero_cost.sql).

BEGIN;

CREATE FUNCTION insert_test_fg_batch(
  p_recipe_id uuid,
  p_tag text,
  p_qty numeric,
  p_unit_cost numeric,
  p_suffix text
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_plan uuid;
  v_plan_product uuid;
  v_session uuid;
  v_session_line uuid;
  v_batch uuid;
BEGIN
  INSERT INTO production_plans (name, planning_date, status)
  VALUES (
    'TEST_PNL_plan_' || p_tag || '_' || p_suffix,
    CURRENT_DATE,
    'completed'
  )
  RETURNING id INTO v_plan;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity,
    yield_quantity, yield_unit, sort_order
  )
  VALUES (
    v_plan, p_recipe_id,
    'TEST_PNL_comp_' || p_tag || '_' || p_suffix,
    p_qty, 1, 'pcs', 1
  )
  RETURNING id INTO v_plan_product;

  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan, 'in_progress', now())
  RETURNING id INTO v_session;

  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (
    v_session, v_plan_product, p_recipe_id,
    'TEST_PNL_comp_' || p_tag || '_' || p_suffix,
    p_qty, p_qty, 'pcs', 1
  )
  RETURNING id INTO v_session_line;

  UPDATE production_sessions
  SET status = 'completed', completed_at = now()
  WHERE id = v_session;

  INSERT INTO production_batches (
    production_session_id, production_session_line_id, finished_good_id,
    recipe_id, produced_quantity, unit_cost, produced_at
  )
  VALUES (
    v_session, v_session_line, p_recipe_id, p_recipe_id,
    p_qty, p_unit_cost, now() - interval '1 hour'
  )
  RETURNING id INTO v_batch;

  RETURN v_batch;
END;
$$;

CREATE FUNCTION insert_test_ledger_line(
  p_entry_date date,
  p_account_code text,
  p_debit numeric,
  p_credit numeric
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_period uuid;
  v_account uuid;
  v_journal uuid;
  v_line uuid;
BEGIN
  -- Journal stays draft: journal_lines_immutable_posted rejects INSERT
  -- onto a posted header. get_profit_and_loss reads ledger_entries only.
  SELECT id INTO v_period
  FROM fiscal_periods
  WHERE p_entry_date BETWEEN start_date AND end_date
  ORDER BY start_date
  LIMIT 1;

  IF v_period IS NULL THEN
    RAISE EXCEPTION
      'No fiscal_periods row covers % — sql/081 FY2026 seed missing?',
      p_entry_date;
  END IF;

  SELECT id INTO v_account
  FROM accounts
  WHERE code = p_account_code;

  IF v_account IS NULL THEN
    RAISE EXCEPTION 'Account % not found.', p_account_code;
  END IF;

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
    v_period,
    p_entry_date,
    'TEST_PNL ' || p_account_code,
    'draft',
    'EUR',
    'EUR',
    1
  )
  RETURNING id INTO v_journal;

  INSERT INTO journal_lines (
    journal_entry_id,
    line_no,
    account_id,
    debit_transaction,
    credit_transaction,
    debit_base,
    credit_base
  )
  VALUES (
    v_journal,
    1,
    v_account,
    p_debit,
    p_credit,
    p_debit,
    p_credit
  )
  RETURNING id INTO v_line;

  INSERT INTO ledger_entries (
    journal_entry_id,
    journal_line_id,
    fiscal_period_id,
    account_id,
    entry_date,
    debit_base,
    credit_base,
    debit_transaction,
    credit_transaction,
    transaction_currency,
    base_currency
  )
  VALUES (
    v_journal,
    v_line,
    v_period,
    v_account,
    p_entry_date,
    p_debit,
    p_credit,
    p_debit,
    p_credit,
    'EUR',
    'EUR'
  );
END;
$$;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_result jsonb;
  v_recipe uuid;
  v_batch uuid;
  v_sale uuid;
  v_line uuid;
  v_mismatch boolean;
BEGIN
  RAISE NOTICE 'auth.uid() live def: %', pg_get_functiondef('auth.uid()'::regprocedure);
  RAISE NOTICE 'require_role live def: %', pg_get_functiondef('require_role(text[])'::regprocedure);
  RAISE NOTICE 'get_profit_and_loss live def: %',
    pg_get_functiondef('get_profit_and_loss(date, date)'::regprocedure);

  SELECT p.auth_user_id, p.role
  INTO v_actor, v_original_role
  FROM profiles p
  WHERE p.is_active = true
    AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION
      'No active owner/partner row in profiles — cannot emulate require_role.';
  END IF;

  v_claims := json_build_object(
    'sub', v_actor::text,
    'role', 'authenticated'
  )::text;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);

  IF auth.uid() IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION
      'auth.uid() emulation failed (got %, expected %).',
      auth.uid(), v_actor;
  END IF;

  IF get_my_role() IS NULL OR get_my_role() NOT IN ('owner', 'partner') THEN
    RAISE EXCEPTION
      'get_my_role() after JWT emulation is % — require_role would fail first.',
      get_my_role();
  END IF;

  RAISE NOTICE 'JWT emulated auth.uid()=% get_my_role()=%', auth.uid(), get_my_role();

  -- ------------------------------------------------------------------ A
  INSERT INTO recipes (name, yield_quantity, yield_unit, recipe_role)
  VALUES (
    'TEST_PNL_recipe_' || v_suffix,
    1,
    'pcs',
    'component'
  )
  RETURNING id INTO v_recipe;

  v_batch := insert_test_fg_batch(v_recipe, 'A', 5, 4, v_suffix);

  INSERT INTO sales (
    sale_number,
    status,
    sale_date,
    confirmed_at,
    subtotal,
    tax_total,
    total
  )
  VALUES (
    'TEST-PNL-A-' || v_suffix,
    'confirmed',
    DATE '2026-06-10',
    TIMESTAMPTZ '2026-06-10 12:00:00+00',
    100.00,
    9.00,
    109.00
  )
  RETURNING id INTO v_sale;

  INSERT INTO sale_lines (
    sale_id, product_id, quantity, unit_price, line_total
  )
  VALUES (
    v_sale, v_recipe, 1, 109.00, 109.00
  )
  RETURNING id INTO v_line;

  INSERT INTO finished_goods_batch_consumptions (
    production_batch_id,
    quantity,
    unit_cost,
    total_cost,
    direction,
    reason,
    source_type,
    source_id
  )
  VALUES (
    v_batch,
    1,
    4,
    4,
    'out',
    'sale',
    'sale_line',
    v_line
  );

  PERFORM insert_test_ledger_line(DATE '2026-06-10', '4000', 0, 100.00);
  PERFORM insert_test_ledger_line(DATE '2026-06-10', '5000', 4.00, 0);
  PERFORM insert_test_ledger_line(DATE '2026-06-10', '6010', 15.00, 0);
  PERFORM insert_test_ledger_line(DATE '2026-06-10', '6150', 2.50, 0);
  PERFORM insert_test_ledger_line(DATE '2026-06-10', '6200', 1.25, 0);

  INSERT INTO ingredient_categories (name)
  VALUES ('TEST_PNL_cat_' || v_suffix);

  INSERT INTO ingredients (name, category_id, unit, current_stock, cost_per_unit)
  VALUES (
    'TEST_PNL_ing_' || v_suffix,
    (SELECT id FROM ingredient_categories WHERE name = 'TEST_PNL_cat_' || v_suffix),
    'kg',
    10,
    2.50
  );

  INSERT INTO write_offs (
    item_type,
    ingredient_id,
    quantity,
    unit_cost,
    total_value,
    reason,
    created_at
  )
  VALUES (
    'ingredient',
    (SELECT id FROM ingredients WHERE name = 'TEST_PNL_ing_' || v_suffix),
    1,
    2.5000,
    2.5000,
    'spoilage',
    TIMESTAMPTZ '2026-06-10 15:00:00+00'
  );

  v_result := get_profit_and_loss(DATE '2026-06-01', DATE '2026-06-30');
  RAISE NOTICE 'A result: %', v_result;

  IF (v_result->>'revenue')::numeric <> 100.00 THEN
    RAISE EXCEPTION 'A revenue expected 100.00 got %', v_result->>'revenue';
  END IF;
  IF (v_result->>'cogs')::numeric <> 4.00 THEN
    RAISE EXCEPTION 'A cogs expected 4.00 got %', v_result->>'cogs';
  END IF;
  IF (v_result->>'gross_profit')::numeric <> 96.00 THEN
    RAISE EXCEPTION 'A gross_profit expected 96.00 got %', v_result->>'gross_profit';
  END IF;
  IF (v_result->>'opex')::numeric <> 15.00 THEN
    RAISE EXCEPTION 'A opex expected 15.00 got %', v_result->>'opex';
  END IF;
  IF jsonb_array_length(v_result->'opex_breakdown') <> 1 THEN
    RAISE EXCEPTION 'A opex_breakdown expected 1 row got %', v_result->'opex_breakdown';
  END IF;
  IF v_result->'opex_breakdown'->0->>'account_code' <> '6010' THEN
    RAISE EXCEPTION 'A opex_breakdown code expected 6010 got %',
      v_result->'opex_breakdown'->0->>'account_code';
  END IF;
  IF (v_result->'opex_breakdown'->0->>'amount')::numeric <> 15.00 THEN
    RAISE EXCEPTION 'A opex_breakdown amount expected 15.00 got %',
      v_result->'opex_breakdown'->0->>'amount';
  END IF;
  IF (v_result->>'write_offs')::numeric <> 2.50 THEN
    RAISE EXCEPTION 'A write_offs expected 2.50 got %', v_result->>'write_offs';
  END IF;
  IF (v_result->>'depreciation')::numeric <> 1.25 THEN
    RAISE EXCEPTION 'A depreciation expected 1.25 got %', v_result->>'depreciation';
  END IF;
  IF (v_result->>'net_profit')::numeric <> 77.25 THEN
    RAISE EXCEPTION 'A net_profit expected 77.25 got %', v_result->>'net_profit';
  END IF;
  IF (v_result#>>'{reconciliation,sales_revenue,operational_amount}')::numeric <> 100.00 THEN
    RAISE EXCEPTION 'A sales_revenue operational expected 100.00 got %',
      v_result#>>'{reconciliation,sales_revenue,operational_amount}';
  END IF;
  IF (v_result#>>'{reconciliation,cogs,operational_amount}')::numeric <> 4.00 THEN
    RAISE EXCEPTION 'A cogs operational expected 4.00 got %',
      v_result#>>'{reconciliation,cogs,operational_amount}';
  END IF;
  IF (v_result#>>'{reconciliation,write_offs,operational_amount}')::numeric <> 2.50 THEN
    RAISE EXCEPTION 'A write_offs operational expected 2.50 got %',
      v_result#>>'{reconciliation,write_offs,operational_amount}';
  END IF;
  IF (v_result#>>'{reconciliation,sales_revenue,mismatch}')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A sales_revenue.mismatch expected false got %',
      v_result#>>'{reconciliation,sales_revenue,mismatch}';
  END IF;
  IF (v_result#>>'{reconciliation,cogs,mismatch}')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A cogs.mismatch expected false got %',
      v_result#>>'{reconciliation,cogs,mismatch}';
  END IF;
  IF (v_result#>>'{reconciliation,write_offs,mismatch}')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A write_offs.mismatch expected false got %',
      v_result#>>'{reconciliation,write_offs,mismatch}';
  END IF;

  RAISE NOTICE 'PASS A — confirmed sale revenue/cogs/write_offs reconcile';

  -- ------------------------------------------------------------------ B
  v_result := get_profit_and_loss(DATE '1999-01-01', DATE '1999-01-31');
  RAISE NOTICE 'B result: %', v_result;

  IF (v_result->>'revenue')::numeric <> 0
    OR (v_result->>'cogs')::numeric <> 0
    OR (v_result->>'gross_profit')::numeric <> 0
    OR (v_result->>'opex')::numeric <> 0
    OR (v_result->>'write_offs')::numeric <> 0
    OR (v_result->>'depreciation')::numeric <> 0
    OR (v_result->>'net_profit')::numeric <> 0
  THEN
    RAISE EXCEPTION 'B expected all P&L amounts 0 got %', v_result;
  END IF;
  IF jsonb_array_length(v_result->'opex_breakdown') <> 0 THEN
    RAISE EXCEPTION 'B opex_breakdown expected [] got %', v_result->'opex_breakdown';
  END IF;
  IF (v_result#>>'{reconciliation,sales_revenue,mismatch}')::boolean IS DISTINCT FROM false
    OR (v_result#>>'{reconciliation,cogs,mismatch}')::boolean IS DISTINCT FROM false
    OR (v_result#>>'{reconciliation,write_offs,mismatch}')::boolean IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'B expected all mismatch=false got %', v_result->'reconciliation';
  END IF;
  IF (v_result#>>'{reconciliation,sales_revenue,operational_amount}')::numeric <> 0
    OR (v_result#>>'{reconciliation,cogs,operational_amount}')::numeric <> 0
    OR (v_result#>>'{reconciliation,write_offs,operational_amount}')::numeric <> 0
  THEN
    RAISE EXCEPTION 'B expected operational amounts 0 got %', v_result->'reconciliation';
  END IF;

  RAISE NOTICE 'PASS B — empty period is zeros with mismatch=false';

  -- ------------------------------------------------------------------ C
  INSERT INTO sales (
    sale_number,
    status,
    sale_date,
    confirmed_at,
    subtotal,
    tax_total,
    total
  )
  VALUES (
    'TEST-PNL-C-' || v_suffix,
    'confirmed',
    DATE '2026-07-15',
    TIMESTAMPTZ '2026-07-15 09:00:00+00',
    50.00,
    4.50,
    54.50
  );

  v_result := get_profit_and_loss(DATE '2026-07-01', DATE '2026-07-31');
  RAISE NOTICE 'C result: %', v_result;

  IF (v_result->>'revenue')::numeric <> 0 THEN
    RAISE EXCEPTION 'C ledger revenue expected 0 got %', v_result->>'revenue';
  END IF;
  IF (v_result#>>'{reconciliation,sales_revenue,operational_amount}')::numeric <> 50.00 THEN
    RAISE EXCEPTION 'C sales_revenue operational expected 50.00 got %',
      v_result#>>'{reconciliation,sales_revenue,operational_amount}';
  END IF;
  v_mismatch := (v_result#>>'{reconciliation,sales_revenue,mismatch}')::boolean;
  IF v_mismatch IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'C sales_revenue.mismatch expected true got %',
      v_result#>>'{reconciliation,sales_revenue,mismatch}';
  END IF;

  RAISE NOTICE 'PASS C — confirmed sale without ledger sets sales_revenue.mismatch';

  -- ------------------------------------------------------------------ D
  INSERT INTO sales (
    sale_number,
    status,
    sale_date,
    confirmed_at,
    paid_at,
    subtotal,
    tax_total,
    total
  )
  VALUES (
    'TEST-PNL-D-' || v_suffix,
    'paid',
    DATE '2026-08-08',
    TIMESTAMPTZ '2026-08-08 11:00:00+00',
    TIMESTAMPTZ '2026-08-08 11:05:00+00',
    80.00,
    7.20,
    87.20
  );

  PERFORM insert_test_ledger_line(DATE '2026-08-08', '4000', 0, 80.00);

  v_result := get_profit_and_loss(DATE '2026-08-01', DATE '2026-08-31');
  RAISE NOTICE 'D result: %', v_result;

  IF (v_result->>'revenue')::numeric <> 80.00 THEN
    RAISE EXCEPTION 'D ledger revenue expected 80.00 got %', v_result->>'revenue';
  END IF;
  IF (v_result#>>'{reconciliation,sales_revenue,operational_amount}')::numeric <> 80.00 THEN
    RAISE EXCEPTION 'D sales_revenue operational expected 80.00 got %',
      v_result#>>'{reconciliation,sales_revenue,operational_amount}';
  END IF;
  IF (v_result#>>'{reconciliation,sales_revenue,mismatch}')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'D sales_revenue.mismatch expected false got %',
      v_result#>>'{reconciliation,sales_revenue,mismatch}';
  END IF;

  RAISE NOTICE 'PASS D — paid sale is included in operational revenue with mismatch=false';

  -- ------------------------------------------------------------------ E
  -- Mirrors sql/120 confirm_sale ingredient_id branch: decrement is
  -- recorded as stock_movements (not finished_goods_batch_consumptions).
  INSERT INTO sales (
    sale_number,
    status,
    sale_date,
    confirmed_at,
    subtotal,
    tax_total,
    total
  )
  VALUES (
    'TEST-PNL-E-' || v_suffix,
    'confirmed',
    DATE '2026-09-12',
    TIMESTAMPTZ '2026-09-12 14:00:00+00',
    20.00,
    1.80,
    21.80
  )
  RETURNING id INTO v_sale;

  INSERT INTO sale_lines (
    sale_id, product_id, quantity, unit_price, line_total
  )
  VALUES (
    v_sale, v_recipe, 1, 21.80, 21.80
  )
  RETURNING id INTO v_line;

  INSERT INTO stock_movements (
    ingredient_id,
    product_id,
    movement_type,
    quantity,
    unit_cost,
    transaction_id,
    reference_type,
    reference_id,
    occurred_at,
    created_at
  )
  VALUES (
    (SELECT id FROM ingredients WHERE name = 'TEST_PNL_ing_' || v_suffix),
    NULL,
    'sale_out',
    2,
    3.5000,
    NULL,
    'sale',
    v_line,
    TIMESTAMPTZ '2026-09-12 14:00:00+00',
    TIMESTAMPTZ '2026-09-12 14:00:00+00'
  );

  PERFORM insert_test_ledger_line(DATE '2026-09-12', '4000', 0, 20.00);
  PERFORM insert_test_ledger_line(DATE '2026-09-12', '5000', 7.00, 0);

  v_result := get_profit_and_loss(DATE '2026-09-01', DATE '2026-09-30');
  RAISE NOTICE 'E result: %', v_result;

  IF (v_result->>'cogs')::numeric <> 7.00 THEN
    RAISE EXCEPTION 'E ledger cogs expected 7.00 got %', v_result->>'cogs';
  END IF;
  IF (v_result#>>'{reconciliation,cogs,operational_amount}')::numeric <> 7.00 THEN
    RAISE EXCEPTION 'E cogs operational expected 7.00 got %',
      v_result#>>'{reconciliation,cogs,operational_amount}';
  END IF;
  IF (v_result#>>'{reconciliation,cogs,mismatch}')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'E cogs.mismatch expected false got %',
      v_result#>>'{reconciliation,cogs,mismatch}';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM finished_goods_batch_consumptions fgbc
    WHERE fgbc.source_id = v_line
      AND fgbc.source_type = 'sale_line'
  ) THEN
    RAISE EXCEPTION 'E must not have fgbc rows for this sale_line';
  END IF;

  RAISE NOTICE 'PASS E — stock_movements sale_out COGS is included with mismatch=false';
END;
$test$;

ROLLBACK;
