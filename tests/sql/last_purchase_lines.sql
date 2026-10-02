-- SQL test: last received purchase lines (sql/132).
-- Scenarios A-F. Not a migration. Always ends in ROLLBACK.
--
-- Requires the full sql/*.sql replay, including
-- sql/132_get_last_purchase_lines.sql, plus
-- tests/sql/bootstrap/prelude_auth.sql and
-- tests/sql/bootstrap/stub_owner_profile.sql (applied by
-- .github/workflows/sql-tests.yml job last-purchase-lines,
-- same prelude as sql-full-replay).
--
-- Runs as the table owner with JWT emulation (same pattern as
-- tests/sql/production_plan_close.sql). It does not SET ROLE.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/last_purchase_lines.sql

BEGIN;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');
  v_err text;
  v_ing_a uuid;
  v_ing_b uuid;
  v_ing_c uuid;
  v_ing_d uuid;
  v_ing_e1 uuid;
  v_ing_e2 uuid;
  v_makro uuid;
  v_sligro uuid;
  v_purchase uuid;
  v_result jsonb;
  v_row jsonb;
  v_line jsonb;
  v_many uuid[];
  v_i integer;
BEGIN
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

  INSERT INTO suppliers (code, name, is_active)
  VALUES (
    'T132M' || right(v_suffix, 12),
    'TEST_LAST_132_Makro_' || v_suffix,
    true
  )
  RETURNING id INTO v_makro;

  INSERT INTO suppliers (code, name, is_active)
  VALUES (
    'T132S' || right(v_suffix, 12),
    'TEST_LAST_132_Sligro_' || v_suffix,
    true
  )
  RETURNING id INTO v_sligro;

  -- ------------------------------------------------------------------
  -- A. Only a received line is returned. A newer draft, a newer
  --    cancelled purchase, and a newer received line with no price
  --    are ignored.
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_LAST_132_A_' || v_suffix, 'kg', 0, 0, 1, true)
  RETURNING id INTO v_ing_a;

  INSERT INTO purchases (supplier_id, status, purchased_at, created_at, notes)
  VALUES (
    v_makro, 'received', '2026-09-01T12:00:00Z', '2026-09-01T12:00:00Z',
    'TEST_LAST_132_A_received'
  )
  RETURNING id INTO v_purchase;

  INSERT INTO purchase_items (
    purchase_id, ingredient_id, quantity, unit_cost, line_total,
    entered_unit_price, price_mode, tax_category, tax_regime, created_at
  ) VALUES (
    v_purchase, v_ing_a, 1, 10, 10,
    14.68, 'inclusive', 'food', 'reduced_vat', '2026-09-01T12:00:00Z'
  );

  INSERT INTO purchases (supplier_id, status, purchased_at, created_at, notes)
  VALUES (
    v_makro, 'draft', '2026-09-20T12:00:00Z', '2026-09-20T12:00:00Z',
    'TEST_LAST_132_A_draft'
  )
  RETURNING id INTO v_purchase;

  INSERT INTO purchase_items (
    purchase_id, ingredient_id, quantity, unit_cost, line_total,
    entered_unit_price, price_mode, created_at
  ) VALUES (
    v_purchase, v_ing_a, 1, 99, 99, 99, 'exclusive', '2026-09-20T12:00:00Z'
  );

  INSERT INTO purchases (supplier_id, status, purchased_at, created_at, notes)
  VALUES (
    v_makro, 'cancelled', '2026-09-21T12:00:00Z', '2026-09-21T12:00:00Z',
    'TEST_LAST_132_A_cancelled'
  )
  RETURNING id INTO v_purchase;

  INSERT INTO purchase_items (
    purchase_id, ingredient_id, quantity, unit_cost, line_total,
    entered_unit_price, price_mode, created_at
  ) VALUES (
    v_purchase, v_ing_a, 1, 88, 88, 88, 'exclusive', '2026-09-21T12:00:00Z'
  );

  INSERT INTO purchases (supplier_id, status, purchased_at, created_at, notes)
  VALUES (
    v_makro, 'received', '2026-09-26T12:00:00Z', '2026-09-26T12:00:00Z',
    'TEST_LAST_132_A_zero'
  )
  RETURNING id INTO v_purchase;

  INSERT INTO purchase_items (
    purchase_id, ingredient_id, quantity, unit_cost, line_total,
    entered_unit_price, price_mode, created_at
  ) VALUES (
    v_purchase, v_ing_a, 1, 0, 0, 0, 'inclusive', '2026-09-26T12:00:00Z'
  );

  v_result := get_last_purchase_lines(ARRAY[v_ing_a], v_makro);
  SELECT elem INTO v_row
  FROM jsonb_array_elements(v_result) elem
  WHERE elem ->> 'ingredient_id' = v_ing_a::text;

  v_line := v_row -> 'any_line';
  IF (v_line ->> 'entered_unit_price')::numeric IS DISTINCT FROM 14.68
     OR v_line ->> 'supplier_name' IS DISTINCT FROM 'TEST_LAST_132_Makro_' || v_suffix THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: any_line %', v_line;
  END IF;

  RAISE NOTICE 'SCENARIO A PASS';

  -- ------------------------------------------------------------------
  -- B. supplier_line is the same supplier even when another supplier
  --    is newer. any_line is the newer one.
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_LAST_132_B_' || v_suffix, 'kg', 0, 0, 1, true)
  RETURNING id INTO v_ing_b;

  INSERT INTO purchases (supplier_id, status, purchased_at, created_at, notes)
  VALUES (
    v_makro, 'received', '2026-09-01T12:00:00Z', '2026-09-01T12:00:00Z',
    'TEST_LAST_132_B_makro'
  )
  RETURNING id INTO v_purchase;

  INSERT INTO purchase_items (
    purchase_id, ingredient_id, quantity, unit_cost, line_total,
    entered_unit_price, price_mode, tax_category, tax_regime, created_at
  ) VALUES (
    v_purchase, v_ing_b, 1, 10, 10,
    14.68, 'inclusive', 'food', 'reduced_vat', '2026-09-01T12:00:00Z'
  );

  INSERT INTO purchases (supplier_id, status, purchased_at, created_at, notes)
  VALUES (
    v_sligro, 'received', '2026-09-26T12:00:00Z', '2026-09-26T12:00:00Z',
    'TEST_LAST_132_B_sligro'
  )
  RETURNING id INTO v_purchase;

  INSERT INTO purchase_items (
    purchase_id, ingredient_id, quantity, unit_cost, line_total,
    entered_unit_price, price_mode, tax_category, tax_regime, created_at
  ) VALUES (
    v_purchase, v_ing_b, 1, 18, 18,
    20, 'exclusive', 'goods', 'standard_vat', '2026-09-26T12:00:00Z'
  );

  v_result := get_last_purchase_lines(ARRAY[v_ing_b], v_makro);
  SELECT elem INTO v_row
  FROM jsonb_array_elements(v_result) elem
  WHERE elem ->> 'ingredient_id' = v_ing_b::text;

  IF (v_row -> 'supplier_line' ->> 'entered_unit_price')::numeric IS DISTINCT FROM 14.68
     OR v_row -> 'supplier_line' ->> 'supplier_id' IS DISTINCT FROM v_makro::text THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: supplier_line %', v_row -> 'supplier_line';
  END IF;
  IF (v_row -> 'any_line' ->> 'entered_unit_price')::numeric IS DISTINCT FROM 20
     OR v_row -> 'any_line' ->> 'supplier_id' IS DISTINCT FROM v_sligro::text THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: any_line %', v_row -> 'any_line';
  END IF;

  RAISE NOTICE 'SCENARIO B PASS';

  -- ------------------------------------------------------------------
  -- C. No same-supplier row → supplier_line null, any_line set
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_LAST_132_C_' || v_suffix, 'kg', 0, 0, 1, true)
  RETURNING id INTO v_ing_c;

  INSERT INTO purchases (supplier_id, status, purchased_at, created_at, notes)
  VALUES (
    v_sligro, 'received', '2026-09-26T12:00:00Z', '2026-09-26T12:00:00Z',
    'TEST_LAST_132_C'
  )
  RETURNING id INTO v_purchase;

  INSERT INTO purchase_items (
    purchase_id, ingredient_id, quantity, unit_cost, line_total,
    entered_unit_price, price_mode, created_at
  ) VALUES (
    v_purchase, v_ing_c, 1, 18, 18, 20, 'exclusive', '2026-09-26T12:00:00Z'
  );

  v_result := get_last_purchase_lines(ARRAY[v_ing_c], v_makro);
  SELECT elem INTO v_row
  FROM jsonb_array_elements(v_result) elem
  WHERE elem ->> 'ingredient_id' = v_ing_c::text;

  IF jsonb_typeof(v_row -> 'supplier_line') IS DISTINCT FROM 'null' THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: supplier_line %', v_row -> 'supplier_line';
  END IF;
  IF (v_row -> 'any_line' ->> 'entered_unit_price')::numeric IS DISTINCT FROM 20 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: any_line %', v_row -> 'any_line';
  END IF;

  RAISE NOTICE 'SCENARIO C PASS';

  -- ------------------------------------------------------------------
  -- D. pre-sql/102 row: entered_unit_price NULL, price_mode NULL
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_LAST_132_D_' || v_suffix, 'kg', 0, 0, 1, true)
  RETURNING id INTO v_ing_d;

  INSERT INTO purchases (supplier_id, status, purchased_at, created_at, notes)
  VALUES (
    v_makro, 'received', '2026-08-01T12:00:00Z', '2026-08-01T12:00:00Z',
    'TEST_LAST_132_D'
  )
  RETURNING id INTO v_purchase;

  INSERT INTO purchase_items (
    purchase_id, ingredient_id, quantity, unit_cost, line_total, created_at
  ) VALUES (
    v_purchase, v_ing_d, 1, 9.5, 9.5, '2026-08-01T12:00:00Z'
  );

  v_result := get_last_purchase_lines(ARRAY[v_ing_d], v_makro);
  SELECT elem INTO v_row
  FROM jsonb_array_elements(v_result) elem
  WHERE elem ->> 'ingredient_id' = v_ing_d::text;

  v_line := v_row -> 'any_line';
  IF (v_line ->> 'unit_cost')::numeric IS DISTINCT FROM 9.5
     OR v_line ->> 'entered_unit_price' IS NOT NULL
     OR v_line ->> 'price_mode' IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: %', v_line;
  END IF;

  RAISE NOTICE 'SCENARIO D PASS';

  -- ------------------------------------------------------------------
  -- E. Two ingredient ids in one call
  -- ------------------------------------------------------------------
  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_LAST_132_E1_' || v_suffix, 'kg', 0, 0, 1, true)
  RETURNING id INTO v_ing_e1;

  INSERT INTO ingredients (name, unit, current_stock, minimum_stock, cost_per_unit, active)
  VALUES ('TEST_LAST_132_E2_' || v_suffix, 'L', 0, 0, 1, true)
  RETURNING id INTO v_ing_e2;

  INSERT INTO purchases (supplier_id, status, purchased_at, created_at, notes)
  VALUES (
    v_makro, 'received', '2026-09-10T12:00:00Z', '2026-09-10T12:00:00Z',
    'TEST_LAST_132_E'
  )
  RETURNING id INTO v_purchase;

  INSERT INTO purchase_items (
    purchase_id, ingredient_id, quantity, unit_cost, line_total,
    entered_unit_price, price_mode, created_at
  ) VALUES
    (v_purchase, v_ing_e1, 1, 3, 3, 3, 'exclusive', '2026-09-10T12:00:00Z'),
    (v_purchase, v_ing_e2, 2, 4, 8, 4, 'exclusive', '2026-09-10T12:00:00Z');

  v_result := get_last_purchase_lines(ARRAY[v_ing_e1, v_ing_e2], v_makro);
  IF (
    SELECT count(*)
    FROM jsonb_array_elements(v_result) elem
    WHERE elem ->> 'ingredient_id' IN (v_ing_e1::text, v_ing_e2::text)
      AND (elem -> 'any_line' ->> 'entered_unit_price')::numeric IN (3, 4)
  ) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: %', v_result;
  END IF;

  RAISE NOTICE 'SCENARIO E PASS';

  -- ------------------------------------------------------------------
  -- F. Empty array and more than 100 ids raise
  -- ------------------------------------------------------------------
  BEGIN
    PERFORM get_last_purchase_lines(ARRAY[]::uuid[], NULL);
    RAISE EXCEPTION 'SCENARIO F FAIL: empty array succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO F FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%At least one ingredient id is required.%' THEN
        RAISE EXCEPTION 'SCENARIO F FAIL: empty message %', v_err;
      END IF;
  END;

  v_many := ARRAY[]::uuid[];
  FOR v_i IN 1..101 LOOP
    v_many := v_many || gen_random_uuid();
  END LOOP;

  BEGIN
    PERFORM get_last_purchase_lines(v_many, NULL);
    RAISE EXCEPTION 'SCENARIO F FAIL: 101 ids succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO F FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%At most 100 ingredient ids are allowed.%' THEN
        RAISE EXCEPTION 'SCENARIO F FAIL: cap message %', v_err;
      END IF;
  END;

  RAISE NOTICE 'SCENARIO F PASS';

  RAISE NOTICE 'last_purchase_lines.sql PASS';
END;
$test$;

ROLLBACK;
