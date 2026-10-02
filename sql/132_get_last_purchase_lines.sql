-- Last received purchase line for the purchase-document price hint
-- (purchases-last-price-prefill).
-- Run in Supabase SQL editor after sql/131_production_plan_close.sql.
-- Apply on both databases (dev + prod):
--   Part 1 dry run (BEGIN...ROLLBACK)
--   Part 2 the real migration (BEGIN...COMMIT)
--   Part 3 standalone catalog checks, fresh tab, no transaction
--
-- Read-only. Does not change receive_purchase, stock, cost, tax calculation,
-- or journal posting. SECURITY INVOKER: owner/partner RLS on purchases and
-- purchase_items is the gate. No require_role.
--
-- ============================================================================
-- PART 1 of 3 -- DRY RUN. Copy everything between "-- >>> DRY RUN START"
-- and "-- <<< DRY RUN END" into the Supabase SQL Editor and run it.
-- Scenarios raise on failure. The transaction rolls back.
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

-- >>> FUNCTION START
CREATE OR REPLACE FUNCTION get_last_purchase_lines(
  p_ingredient_ids uuid[],
  p_supplier_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_result jsonb;
BEGIN
  IF p_ingredient_ids IS NULL OR cardinality(p_ingredient_ids) = 0 THEN
    RAISE EXCEPTION 'At least one ingredient id is required.';
  END IF;

  IF cardinality(p_ingredient_ids) > 100 THEN
    RAISE EXCEPTION 'At most 100 ingredient ids are allowed.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::uuid[])
  INTO v_ids
  FROM unnest(p_ingredient_ids) AS id
  WHERE id IS NOT NULL;

  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'At least one ingredient id is required.';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'ingredient_id', q.ingredient_id,
        'supplier_line', q.supplier_line,
        'any_line', q.any_line
      )
      ORDER BY q.ingredient_id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT
      i.id AS ingredient_id,
      (
        SELECT jsonb_build_object(
          'entered_unit_price', pi.entered_unit_price,
          'unit_cost', pi.unit_cost,
          'price_mode', pi.price_mode,
          'tax_category', pi.tax_category,
          'tax_regime', pi.tax_regime,
          'purchased_at', p.purchased_at,
          'supplier_id', p.supplier_id,
          'supplier_name', s.name
        )
        FROM purchase_items pi
        JOIN purchases p
          ON p.id = pi.purchase_id
        LEFT JOIN suppliers s
          ON s.id = p.supplier_id
        WHERE pi.ingredient_id = i.id
          AND p.status = 'received'
          AND p_supplier_id IS NOT NULL
          AND p.supplier_id = p_supplier_id
          AND NOT (
            COALESCE(pi.entered_unit_price, 0) <= 0
            AND pi.unit_cost <= 0
          )
        ORDER BY p.purchased_at DESC, p.created_at DESC, pi.created_at DESC
        LIMIT 1
      ) AS supplier_line,
      (
        SELECT jsonb_build_object(
          'entered_unit_price', pi.entered_unit_price,
          'unit_cost', pi.unit_cost,
          'price_mode', pi.price_mode,
          'tax_category', pi.tax_category,
          'tax_regime', pi.tax_regime,
          'purchased_at', p.purchased_at,
          'supplier_id', p.supplier_id,
          'supplier_name', s.name
        )
        FROM purchase_items pi
        JOIN purchases p
          ON p.id = pi.purchase_id
        LEFT JOIN suppliers s
          ON s.id = p.supplier_id
        WHERE pi.ingredient_id = i.id
          AND p.status = 'received'
          AND NOT (
            COALESCE(pi.entered_unit_price, 0) <= 0
            AND pi.unit_cost <= 0
          )
        ORDER BY p.purchased_at DESC, p.created_at DESC, pi.created_at DESC
        LIMIT 1
      ) AS any_line
    FROM unnest(v_ids) AS i(id)
  ) q;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_last_purchase_lines(uuid[], uuid) IS
  'Latest received purchase line per ingredient: same supplier when p_supplier_id matches, and the latest from any supplier. Skips lines whose entered price and net unit cost are both <= 0. Invoker; RLS applies. Read-only.';

REVOKE ALL ON FUNCTION get_last_purchase_lines(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_last_purchase_lines(uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION get_last_purchase_lines(uuid[], uuid) TO authenticated;
-- <<< FUNCTION END

-- Dry-run only (this transaction rolls back). Vanilla Postgres replay does
-- not grant these tables to authenticated; Supabase does.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  ingredients,
  suppliers,
  purchases,
  purchase_items
TO authenticated;

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

  SET LOCAL ROLE authenticated;

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

  -- ------------------------------------------------------------------
  -- G. Seller JWT sees no prices (RLS), and the call does not raise
  -- ------------------------------------------------------------------
  RESET ROLE;
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;

  BEGIN
    BEGIN
      v_result := get_last_purchase_lines(ARRAY[v_ing_b], v_makro);
      SELECT elem INTO v_row
      FROM jsonb_array_elements(v_result) elem
      WHERE elem ->> 'ingredient_id' = v_ing_b::text;

      IF jsonb_typeof(v_row -> 'supplier_line') IS DISTINCT FROM 'null'
         OR jsonb_typeof(v_row -> 'any_line') IS DISTINCT FROM 'null'
         OR v_result::text LIKE '%14.68%'
         OR v_result::text LIKE '%TEST_LAST_132%' THEN
        RAISE EXCEPTION 'SCENARIO G FAIL: seller saw %', v_result;
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err LIKE 'SCENARIO G FAIL:%' THEN
          RAISE;
        END IF;
        RAISE EXCEPTION 'SCENARIO G FAIL: unexpected error %', v_err;
    END;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
      RAISE;
  END;

  RESET ROLE;
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;

  RAISE NOTICE 'SCENARIO G PASS';
  RAISE NOTICE 'sql/132 dry run: scenarios A-G passed';
END;
$test$;

ROLLBACK;
-- <<< DRY RUN END

-- ============================================================================
-- PART 2 of 3 -- REAL MIGRATION. Run only after Part 1 passes.
-- Identical function body and grants. No scenarios.
-- ============================================================================

-- >>> MIGRATION START
BEGIN;

-- >>> FUNCTION START
CREATE OR REPLACE FUNCTION get_last_purchase_lines(
  p_ingredient_ids uuid[],
  p_supplier_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  v_result jsonb;
BEGIN
  IF p_ingredient_ids IS NULL OR cardinality(p_ingredient_ids) = 0 THEN
    RAISE EXCEPTION 'At least one ingredient id is required.';
  END IF;

  IF cardinality(p_ingredient_ids) > 100 THEN
    RAISE EXCEPTION 'At most 100 ingredient ids are allowed.';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT id), ARRAY[]::uuid[])
  INTO v_ids
  FROM unnest(p_ingredient_ids) AS id
  WHERE id IS NOT NULL;

  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'At least one ingredient id is required.';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'ingredient_id', q.ingredient_id,
        'supplier_line', q.supplier_line,
        'any_line', q.any_line
      )
      ORDER BY q.ingredient_id
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM (
    SELECT
      i.id AS ingredient_id,
      (
        SELECT jsonb_build_object(
          'entered_unit_price', pi.entered_unit_price,
          'unit_cost', pi.unit_cost,
          'price_mode', pi.price_mode,
          'tax_category', pi.tax_category,
          'tax_regime', pi.tax_regime,
          'purchased_at', p.purchased_at,
          'supplier_id', p.supplier_id,
          'supplier_name', s.name
        )
        FROM purchase_items pi
        JOIN purchases p
          ON p.id = pi.purchase_id
        LEFT JOIN suppliers s
          ON s.id = p.supplier_id
        WHERE pi.ingredient_id = i.id
          AND p.status = 'received'
          AND p_supplier_id IS NOT NULL
          AND p.supplier_id = p_supplier_id
          AND NOT (
            COALESCE(pi.entered_unit_price, 0) <= 0
            AND pi.unit_cost <= 0
          )
        ORDER BY p.purchased_at DESC, p.created_at DESC, pi.created_at DESC
        LIMIT 1
      ) AS supplier_line,
      (
        SELECT jsonb_build_object(
          'entered_unit_price', pi.entered_unit_price,
          'unit_cost', pi.unit_cost,
          'price_mode', pi.price_mode,
          'tax_category', pi.tax_category,
          'tax_regime', pi.tax_regime,
          'purchased_at', p.purchased_at,
          'supplier_id', p.supplier_id,
          'supplier_name', s.name
        )
        FROM purchase_items pi
        JOIN purchases p
          ON p.id = pi.purchase_id
        LEFT JOIN suppliers s
          ON s.id = p.supplier_id
        WHERE pi.ingredient_id = i.id
          AND p.status = 'received'
          AND NOT (
            COALESCE(pi.entered_unit_price, 0) <= 0
            AND pi.unit_cost <= 0
          )
        ORDER BY p.purchased_at DESC, p.created_at DESC, pi.created_at DESC
        LIMIT 1
      ) AS any_line
    FROM unnest(v_ids) AS i(id)
  ) q;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_last_purchase_lines(uuid[], uuid) IS
  'Latest received purchase line per ingredient: same supplier when p_supplier_id matches, and the latest from any supplier. Skips lines whose entered price and net unit cost are both <= 0. Invoker; RLS applies. Read-only.';

REVOKE ALL ON FUNCTION get_last_purchase_lines(uuid[], uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_last_purchase_lines(uuid[], uuid) FROM anon;
GRANT EXECUTE ON FUNCTION get_last_purchase_lines(uuid[], uuid) TO authenticated;
-- <<< FUNCTION END

COMMIT;
-- <<< MIGRATION END

-- ============================================================================
-- PART 3 of 3 -- STANDALONE POST-COMMIT VERIFICATION.
-- Fresh SQL Editor tab. Do not wrap this in a transaction.
-- The SELECT is the last statement.
-- PUBLIC is not a role name, so has_function_privilege cannot take it;
-- public_execute reads the ACL (grantee 0). A NULL proacl means the
-- default PUBLIC EXECUTE grant is still in force.
-- ============================================================================

DO $catalog$
DECLARE
  v_prosecdef boolean;
  v_volatile "char";
  v_anon boolean;
  v_authenticated boolean;
  v_public boolean;
BEGIN
  SELECT p.prosecdef, p.provolatile
  INTO v_prosecdef, v_volatile
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_last_purchase_lines';

  IF v_prosecdef IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'get_last_purchase_lines should stay SECURITY INVOKER';
  END IF;
  IF v_volatile IS DISTINCT FROM 's' THEN
    RAISE EXCEPTION 'get_last_purchase_lines should be STABLE (provolatile %)', v_volatile;
  END IF;

  SELECT
    has_function_privilege('anon', p.oid, 'EXECUTE'),
    has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    CASE
      WHEN p.proacl IS NULL THEN true
      ELSE EXISTS (
        SELECT 1
        FROM aclexplode(p.proacl) AS x
        WHERE x.grantee = 0
          AND x.privilege_type = 'EXECUTE'
      )
    END
  INTO v_anon, v_authenticated, v_public
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_last_purchase_lines';

  IF v_anon OR v_public OR NOT v_authenticated THEN
    RAISE EXCEPTION
      'get_last_purchase_lines privileges anon % public % authenticated %',
      v_anon, v_public, v_authenticated;
  END IF;
END;
$catalog$;

SELECT
  p.proname,
  p.prosecdef,
  p.provolatile,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  CASE
    WHEN p.proacl IS NULL THEN true
    ELSE EXISTS (
      SELECT 1
      FROM aclexplode(p.proacl) AS x
      WHERE x.grantee = 0
        AND x.privilege_type = 'EXECUTE'
    )
  END AS public_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_last_purchase_lines';
