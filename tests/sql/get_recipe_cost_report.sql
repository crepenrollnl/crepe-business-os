-- SQL test: calculate_recipe_cost / get_recipe_cost_detail /
-- get_recipe_cost_report (sql/122).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1. Do not run against shared live
-- dev as a CI job (E2E already uses that project over REST).
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/get_recipe_cost_report.sql
-- (exit 0). Bootstrap: tests/sql/bootstrap/recipe_cost_report.list
-- (applied by the preceding sql-recipe-cost-report.yml step in CI).
--
-- Scenarios:
--   A — simple Component, no nesting: total_cost = SUM(qty × cost)
--   B — Component with nested Component (marinade inside chicken):
--       total_cost includes the child's exploded leaves
--   C — Assembly (chicken component + raw sauce add-in): total_cost
--       is not zero and sums both branches
--   D — Component with cost_per_unit = 0: has_missing_cost_data = true
--   E — Component cycle: get_recipe_cost_detail raises; the report
--       keeps other rows and sets calculation_error on the cycle pair
--   F — anon EXECUTE on both public RPCs is 42501 / privilege false
--
-- Actor: stub_owner_profile.sql (applied after sql/097). JWT GUCs match
-- prelude_auth.sql's auth.uid().

BEGIN;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');

  v_cat uuid;
  v_flour uuid;
  v_milk uuid;
  v_soy uuid;
  v_chicken_meat uuid;
  v_sauce uuid;
  v_zero uuid;

  v_batter uuid;
  v_marinade uuid;
  v_chicken uuid;
  v_crepe uuid;
  v_zero_recipe uuid;
  v_cycle_a uuid;
  v_cycle_b uuid;

  v_detail jsonb;
  v_report jsonb;
  v_row jsonb;
  v_err text;
  v_sqlstate text;
  v_raised boolean;
  v_anon_detail boolean;
  v_anon_report boolean;
BEGIN
  RAISE NOTICE 'auth.uid() live def: %', pg_get_functiondef('auth.uid()'::regprocedure);
  RAISE NOTICE 'require_role live def: %', pg_get_functiondef('require_role(text[])'::regprocedure);
  RAISE NOTICE 'get_recipe_cost_report live def: %',
    pg_get_functiondef('get_recipe_cost_report()'::regprocedure);
  RAISE NOTICE 'get_recipe_cost_detail live def: %',
    pg_get_functiondef('get_recipe_cost_detail(uuid)'::regprocedure);

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

  INSERT INTO ingredient_categories (name)
  VALUES ('TEST_RCR_cat_' || v_suffix)
  RETURNING id INTO v_cat;

  INSERT INTO ingredients (name, category_id, unit, current_stock, cost_per_unit)
  VALUES
    ('TEST_RCR_flour_' || v_suffix, v_cat, 'kg', 20, 1.50),
    ('TEST_RCR_milk_' || v_suffix, v_cat, 'L', 10, 0.80),
    ('TEST_RCR_soy_' || v_suffix, v_cat, 'L', 5, 10.00),
    ('TEST_RCR_meat_' || v_suffix, v_cat, 'kg', 8, 8.00),
    ('TEST_RCR_sauce_' || v_suffix, v_cat, 'kg', 3, 5.00),
    ('TEST_RCR_zero_' || v_suffix, v_cat, 'kg', 2, 0);

  SELECT id INTO v_flour FROM ingredients WHERE name = 'TEST_RCR_flour_' || v_suffix;
  SELECT id INTO v_milk FROM ingredients WHERE name = 'TEST_RCR_milk_' || v_suffix;
  SELECT id INTO v_soy FROM ingredients WHERE name = 'TEST_RCR_soy_' || v_suffix;
  SELECT id INTO v_chicken_meat FROM ingredients WHERE name = 'TEST_RCR_meat_' || v_suffix;
  SELECT id INTO v_sauce FROM ingredients WHERE name = 'TEST_RCR_sauce_' || v_suffix;
  SELECT id INTO v_zero FROM ingredients WHERE name = 'TEST_RCR_zero_' || v_suffix;

  -- ------------------------------------------------------------------ A
  INSERT INTO recipes (name, yield_quantity, yield_unit, recipe_role, is_active)
  VALUES (
    'TEST_RCR_batter_' || v_suffix,
    4,
    'portion',
    'component',
    true
  )
  RETURNING id INTO v_batter;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES
    (v_batter, v_flour, 2, 'kg'),
    (v_batter, v_milk, 1, 'L');

  v_detail := get_recipe_cost_detail(v_batter);
  RAISE NOTICE 'A detail: %', v_detail;

  IF (v_detail->>'total_cost')::numeric <> 3.8000 THEN
    RAISE EXCEPTION 'A total_cost expected 3.8000 got %', v_detail->>'total_cost';
  END IF;
  IF (v_detail->>'cost_per_yield_unit')::numeric <> 0.9500 THEN
    RAISE EXCEPTION 'A cost_per_yield_unit expected 0.9500 got %',
      v_detail->>'cost_per_yield_unit';
  END IF;
  IF (v_detail->>'has_missing_cost_data')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A has_missing_cost_data expected false got %',
      v_detail->>'has_missing_cost_data';
  END IF;
  IF jsonb_array_length(v_detail->'missing_ingredients') <> 0 THEN
    RAISE EXCEPTION 'A missing_ingredients expected [] got %',
      v_detail->'missing_ingredients';
  END IF;
  IF jsonb_array_length(v_detail->'ingredient_breakdown') <> 2 THEN
    RAISE EXCEPTION 'A breakdown expected 2 rows got %',
      v_detail->'ingredient_breakdown';
  END IF;
  IF (v_detail->'ingredient_breakdown'->0->>'line_cost')::numeric
     < (v_detail->'ingredient_breakdown'->1->>'line_cost')::numeric THEN
    RAISE EXCEPTION 'A breakdown is not sorted by line_cost DESC';
  END IF;

  RAISE NOTICE 'PASS A — simple component total_cost matches qty × cost';

  -- ------------------------------------------------------------------ B
  INSERT INTO recipes (name, yield_quantity, yield_unit, recipe_role)
  VALUES (
    'TEST_RCR_marinade_' || v_suffix,
    1,
    'kg',
    'component'
  )
  RETURNING id INTO v_marinade;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_marinade, v_soy, 0.100, 'L');

  INSERT INTO recipes (name, yield_quantity, yield_unit, recipe_role)
  VALUES (
    'TEST_RCR_chicken_' || v_suffix,
    1,
    'kg',
    'component'
  )
  RETURNING id INTO v_chicken;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_chicken, v_chicken_meat, 0.500, 'kg');

  INSERT INTO recipe_components (
    assembly_recipe_id, component_recipe_id, quantity, unit
  )
  VALUES (v_chicken, v_marinade, 0.500, 'kg');

  v_detail := get_recipe_cost_detail(v_chicken);
  RAISE NOTICE 'B detail: %', v_detail;

  -- meat 0.5 × 8.00 = 4.00; marinade scale 0.5/1 → soy 0.05 × 10.00 = 0.50
  IF (v_detail->>'total_cost')::numeric <> 4.5000 THEN
    RAISE EXCEPTION 'B total_cost expected 4.5000 got %', v_detail->>'total_cost';
  END IF;
  IF (v_detail->>'has_missing_cost_data')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'B has_missing_cost_data expected false got %',
      v_detail->>'has_missing_cost_data';
  END IF;

  RAISE NOTICE 'PASS B — nested component cost includes marinade leaves';

  -- ------------------------------------------------------------------ C
  INSERT INTO recipes (
    name, yield_quantity, yield_unit, recipe_role, selling_price
  )
  VALUES (
    'TEST_RCR_crepe_' || v_suffix,
    1,
    'pcs',
    'assembly',
    9.50
  )
  RETURNING id INTO v_crepe;

  INSERT INTO recipe_components (
    assembly_recipe_id, component_recipe_id, quantity, unit
  )
  VALUES (v_crepe, v_chicken, 1, 'kg');

  INSERT INTO recipe_components (
    assembly_recipe_id, ingredient_id, quantity, unit
  )
  VALUES (v_crepe, v_sauce, 0.020, 'kg');

  v_detail := get_recipe_cost_detail(v_crepe);
  RAISE NOTICE 'C detail: %', v_detail;

  -- chicken 4.50 + sauce 0.02 × 5.00 = 0.10 → 4.60
  IF (v_detail->>'total_cost')::numeric IS NOT DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'C total_cost must not be 0 got %', v_detail->>'total_cost';
  END IF;
  IF (v_detail->>'total_cost')::numeric <> 4.6000 THEN
    RAISE EXCEPTION 'C total_cost expected 4.6000 got %', v_detail->>'total_cost';
  END IF;
  IF v_detail->>'recipe_role' <> 'assembly' THEN
    RAISE EXCEPTION 'C recipe_role expected assembly got %', v_detail->>'recipe_role';
  END IF;
  IF jsonb_array_length(v_detail->'ingredient_breakdown') <> 3 THEN
    RAISE EXCEPTION 'C breakdown expected 3 leaves (meat, soy, sauce) got %',
      v_detail->'ingredient_breakdown';
  END IF;

  RAISE NOTICE 'PASS C — assembly sums component explode + raw add-in';

  -- ------------------------------------------------------------------ D
  INSERT INTO recipes (name, yield_quantity, yield_unit, recipe_role)
  VALUES (
    'TEST_RCR_zero_' || v_suffix,
    1,
    'kg',
    'component'
  )
  RETURNING id INTO v_zero_recipe;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES (v_zero_recipe, v_zero, 1, 'kg');

  v_detail := get_recipe_cost_detail(v_zero_recipe);
  RAISE NOTICE 'D detail: %', v_detail;

  IF (v_detail->>'has_missing_cost_data')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'D has_missing_cost_data expected true got %',
      v_detail->>'has_missing_cost_data';
  END IF;
  IF jsonb_array_length(v_detail->'missing_ingredients') <> 1 THEN
    RAISE EXCEPTION 'D missing_ingredients expected 1 row got %',
      v_detail->'missing_ingredients';
  END IF;
  IF (v_detail->'missing_ingredients'->0->>'ingredient_id')::uuid IS DISTINCT FROM v_zero THEN
    RAISE EXCEPTION 'D missing ingredient_id expected % got %',
      v_zero, v_detail->'missing_ingredients'->0->>'ingredient_id';
  END IF;
  IF (v_detail->>'total_cost')::numeric <> 0 THEN
    RAISE EXCEPTION 'D total_cost expected 0 got %', v_detail->>'total_cost';
  END IF;

  RAISE NOTICE 'PASS D — zero cost_per_unit sets has_missing_cost_data';

  -- ------------------------------------------------------------------ E
  INSERT INTO recipes (name, yield_quantity, yield_unit, recipe_role)
  VALUES (
    'TEST_RCR_cycle_a_' || v_suffix,
    1,
    'kg',
    'component'
  )
  RETURNING id INTO v_cycle_a;

  INSERT INTO recipes (name, yield_quantity, yield_unit, recipe_role)
  VALUES (
    'TEST_RCR_cycle_b_' || v_suffix,
    1,
    'kg',
    'component'
  )
  RETURNING id INTO v_cycle_b;

  INSERT INTO recipe_items (recipe_id, ingredient_id, quantity, unit)
  VALUES
    (v_cycle_a, v_flour, 0.100, 'kg'),
    (v_cycle_b, v_milk, 0.100, 'L');

  INSERT INTO recipe_components (
    assembly_recipe_id, component_recipe_id, quantity, unit
  )
  VALUES
    (v_cycle_a, v_cycle_b, 0.100, 'kg'),
    (v_cycle_b, v_cycle_a, 0.100, 'kg');

  v_raised := false;
  BEGIN
    v_detail := get_recipe_cost_detail(v_cycle_a);
    RAISE EXCEPTION 'E FAIL: get_recipe_cost_detail succeeded on a cycle';
  EXCEPTION
    WHEN others THEN
      v_err := SQLERRM;
      v_sqlstate := SQLSTATE;
      IF v_err LIKE 'E FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT ILIKE '%cycle%' THEN
        RAISE EXCEPTION
          'E unexpected get_recipe_cost_detail error (sqlstate=%): %',
          v_sqlstate, v_err;
      END IF;
      v_raised := true;
      RAISE NOTICE 'E detail raised as expected (sqlstate=%): %', v_sqlstate, v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'E FAIL: get_recipe_cost_detail did not raise on a cycle';
  END IF;

  v_report := get_recipe_cost_report();
  RAISE NOTICE 'E report rows: %', jsonb_array_length(v_report);

  SELECT value
  INTO v_row
  FROM jsonb_array_elements(v_report) AS t(value)
  WHERE (value->>'recipe_id')::uuid = v_cycle_a;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'E report is missing cycle recipe A';
  END IF;
  IF v_row->>'calculation_error' IS NULL
     OR v_row->>'calculation_error' NOT ILIKE '%cycle%' THEN
    RAISE EXCEPTION 'E cycle A calculation_error expected cycle text got %',
      v_row->>'calculation_error';
  END IF;
  IF v_row->>'total_cost' IS NOT NULL THEN
    RAISE EXCEPTION 'E cycle A total_cost expected null got %',
      v_row->>'total_cost';
  END IF;

  SELECT value
  INTO v_row
  FROM jsonb_array_elements(v_report) AS t(value)
  WHERE (value->>'recipe_id')::uuid = v_batter;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'E report is missing batter recipe';
  END IF;
  IF v_row->>'calculation_error' IS NOT NULL THEN
    RAISE EXCEPTION 'E batter calculation_error expected null got %',
      v_row->>'calculation_error';
  END IF;
  IF (v_row->>'total_cost')::numeric <> 3.8000 THEN
    RAISE EXCEPTION 'E batter total_cost expected 3.8000 got %',
      v_row->>'total_cost';
  END IF;

  SELECT value
  INTO v_row
  FROM jsonb_array_elements(v_report) AS t(value)
  WHERE (value->>'recipe_id')::uuid = v_crepe;

  IF v_row IS NULL OR (v_row->>'total_cost')::numeric <> 4.6000 THEN
    RAISE EXCEPTION 'E crepe row missing or wrong total_cost: %', v_row;
  END IF;

  RAISE NOTICE 'PASS E — detail raises on cycle; report isolates the error';

  -- ------------------------------------------------------------------ F
  v_anon_detail := has_function_privilege(
    'anon',
    'get_recipe_cost_detail(uuid)',
    'EXECUTE'
  );
  v_anon_report := has_function_privilege(
    'anon',
    'get_recipe_cost_report()',
    'EXECUTE'
  );

  IF v_anon_detail IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'F anon EXECUTE on get_recipe_cost_detail expected false got %',
      v_anon_detail;
  END IF;
  IF v_anon_report IS DISTINCT FROM false THEN
    RAISE EXCEPTION
      'F anon EXECUTE on get_recipe_cost_report expected false got %',
      v_anon_report;
  END IF;

  v_raised := false;
  BEGIN
    SET LOCAL ROLE anon;
    v_report := get_recipe_cost_report();
    RESET ROLE;
    RAISE EXCEPTION 'F FAIL: anon get_recipe_cost_report succeeded';
  EXCEPTION
    WHEN others THEN
      RESET ROLE;
      v_err := SQLERRM;
      v_sqlstate := SQLSTATE;
      IF v_err LIKE 'F FAIL:%' THEN
        RAISE;
      END IF;
      IF v_sqlstate IS DISTINCT FROM '42501' THEN
        RAISE EXCEPTION
          'F get_recipe_cost_report unexpected sqlstate=% err=%',
          v_sqlstate, v_err;
      END IF;
      v_raised := true;
      RAISE NOTICE 'F report anon blocked (sqlstate=%): %', v_sqlstate, v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'F FAIL: anon get_recipe_cost_report was not blocked';
  END IF;

  v_raised := false;
  BEGIN
    SET LOCAL ROLE anon;
    v_detail := get_recipe_cost_detail(v_batter);
    RESET ROLE;
    RAISE EXCEPTION 'F FAIL: anon get_recipe_cost_detail succeeded';
  EXCEPTION
    WHEN others THEN
      RESET ROLE;
      v_err := SQLERRM;
      v_sqlstate := SQLSTATE;
      IF v_err LIKE 'F FAIL:%' THEN
        RAISE;
      END IF;
      IF v_sqlstate IS DISTINCT FROM '42501' THEN
        RAISE EXCEPTION
          'F get_recipe_cost_detail unexpected sqlstate=% err=%',
          v_sqlstate, v_err;
      END IF;
      v_raised := true;
      RAISE NOTICE 'F detail anon blocked (sqlstate=%): %', v_sqlstate, v_err;
  END;

  IF NOT v_raised THEN
    RAISE EXCEPTION 'F FAIL: anon get_recipe_cost_detail was not blocked';
  END IF;

  RAISE NOTICE 'PASS F — anon EXECUTE denied (42501) on both RPCs';
END;
$test$;

ROLLBACK;
