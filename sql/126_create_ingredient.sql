-- Atomic ingredient create with optional opening-stock ledger event.
--
-- Run in Supabase SQL Editor after sql/125_record_inventory_adjustment.sql.
-- Do NOT apply to a live database until explicitly approved. This file is
-- a self-rolling-back dry run + the later apply script.
--
-- Why this exists:
--   Add used to INSERT ingredients.current_stock directly. After sql/125,
--   that still works (INSERT is not trigger-blocked) but leaves no
--   stock_movements / inventory_adjustments row. A two-step client
--   flow (INSERT at 10, then record_inventory_adjustment +10) doubles
--   stock to 20. INSERT at 0 then a second client RPC can leave the
--   card at 0 if the second call fails.
--
--   create_ingredient is one SECURITY DEFINER transaction:
--     1. INSERT the card with current_stock = 0 and the given
--        cost_per_unit (INSERT is not trigger-blocked).
--     2. If opening qty > 0: PERFORM record_inventory_adjustment(
--        ..., 'increase', qty, 'opening_stock', note) — same increment,
--        movement, and inventory_adjustments path as Adjust Stock.
--     3. If opening is 0: no movement (same as today's empty start).
--     4. Return the ingredient row (final current_stock).
--
-- Role: PERFORM require_role('owner', 'partner') is the first statement.
--
-- Duplicate name: not checked here. ingredients.name has no UNIQUE
-- constraint. The existing TypeScript findDuplicateName stays the
-- only name-uniqueness guard.
--
-- Journal posting is NOT in this RPC (same as sql/125).
--
-- Does NOT:
--   - change record_inventory_adjustment
--   - write journal_entries / ledger_entries / transactions
--   - add a unique name constraint
--   - create, delete, or modify any real Auth user or profiles row
--     outside the dry run's own BEGIN...ROLLBACK block
--
-- ============================================================================
-- PART 1 of 2 — DRY RUN (BEGIN...ROLLBACK). Copy everything between
-- "-- >>> DRY RUN START" and "-- <<< DRY RUN END" into the SQL Editor
-- and run it FIRST. Nothing persists.
--
--   (A) owner  opening qty > 0 — current_stock matches opening (not
--       doubled), adjustment_increase + inventory_adjustments
--       (reason='opening_stock') both exist and are correct
--   (B) owner  opening qty = 0 — no movement / adjustment row
--   (C) partner — same as A
--   (D) seller — 42501 / Insufficient permissions; row-count
--       before/after: nothing inserted anywhere
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

CREATE OR REPLACE FUNCTION create_ingredient(
  p_name text,
  p_unit text,
  p_category_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_minimum_stock numeric DEFAULT 0,
  p_cost_per_unit numeric DEFAULT 0,
  p_opening_quantity numeric DEFAULT 0,
  p_opening_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_unit text := btrim(COALESCE(p_unit, ''));
  v_opening numeric(12, 3) := COALESCE(p_opening_quantity, 0);
  v_minimum numeric(12, 3) := COALESCE(p_minimum_stock, 0);
  v_cost numeric(12, 2) := COALESCE(p_cost_per_unit, 0);
  v_row ingredients%ROWTYPE;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF v_name = '' THEN
    RAISE EXCEPTION 'Ingredient name is required.';
  END IF;

  IF v_unit = '' THEN
    RAISE EXCEPTION 'Ingredient unit is required.';
  END IF;

  IF v_opening < 0 THEN
    RAISE EXCEPTION 'Opening stock must be 0 or greater.';
  END IF;

  IF v_minimum < 0 THEN
    RAISE EXCEPTION 'Minimum stock must be 0 or greater.';
  END IF;

  IF v_cost < 0 THEN
    RAISE EXCEPTION 'Cost per unit must be 0 or greater.';
  END IF;

  INSERT INTO ingredients (
    name,
    category_id,
    supplier_id,
    unit,
    current_stock,
    minimum_stock,
    cost_per_unit
  )
  VALUES (
    v_name,
    p_category_id,
    p_supplier_id,
    v_unit,
    0,
    v_minimum,
    v_cost
  )
  RETURNING * INTO v_row;

  IF v_opening > 0 THEN
    PERFORM record_inventory_adjustment(
      v_row.id,
      'increase',
      v_opening,
      'opening_stock',
      p_opening_note
    );

    SELECT *
    INTO v_row
    FROM ingredients
    WHERE id = v_row.id;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION create_ingredient(
  text, text, uuid, uuid, numeric, numeric, numeric, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_ingredient(
  text, text, uuid, uuid, numeric, numeric, numeric, text
) FROM anon;
GRANT EXECUTE ON FUNCTION create_ingredient(
  text, text, uuid, uuid, numeric, numeric, numeric, text
) TO authenticated;

DO $test$
DECLARE
  v_owner uuid;
  v_partner uuid;
  v_actor uuid;
  v_flipped_owner_to_partner boolean := false;
  v_claims text;
  v_result jsonb;
  v_id uuid;
  v_stock numeric;
  v_cost numeric;
  v_seen integer;
  v_ing_before integer;
  v_adj_before integer;
  v_mov_before integer;
  v_ing_after integer;
  v_adj_after integer;
  v_mov_after integer;
  v_err text;
  v_sqlstate text;
BEGIN
  SELECT p.auth_user_id
  INTO v_owner
  FROM profiles p
  WHERE p.is_active = true
    AND p.role = 'owner'
  ORDER BY p.auth_user_id
  LIMIT 1;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION
      'No active owner row in profiles — cannot emulate get_my_role().';
  END IF;

  SELECT p.auth_user_id
  INTO v_partner
  FROM profiles p
  WHERE p.is_active = true
    AND p.role = 'partner'
    AND p.auth_user_id IS DISTINCT FROM v_owner
  ORDER BY p.auth_user_id
  LIMIT 1;

  v_actor := v_owner;
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

  -- ----------------------------------------------------------------------
  -- SCENARIO A: owner, opening qty > 0
  -- ----------------------------------------------------------------------
  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'owner' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'SCENARIO A FAIL: get_my_role() is % — expected owner.',
      get_my_role();
  END IF;

  v_result := create_ingredient(
    '__sql126_dry_run_a__',
    'kg',
    NULL,
    NULL,
    0,
    4.25,
    10,
    'sql126 scenario A'
  );

  RESET ROLE;

  IF v_result IS NULL OR v_result ->> 'id' IS NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: RPC returned incomplete jsonb %', v_result;
  END IF;

  v_id := (v_result ->> 'id')::uuid;

  SELECT current_stock, cost_per_unit
  INTO v_stock, v_cost
  FROM ingredients
  WHERE id = v_id;

  IF v_stock IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: current_stock % — expected 10 (not doubled)',
      v_stock;
  END IF;

  IF (v_result ->> 'current_stock')::numeric IS DISTINCT FROM 10 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: returned current_stock % — expected 10',
      v_result ->> 'current_stock';
  END IF;

  IF v_cost IS DISTINCT FROM 4.25 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: cost_per_unit % — expected 4.25',
      v_cost;
  END IF;

  SELECT count(*) INTO v_seen
  FROM stock_movements
  WHERE ingredient_id = v_id
    AND movement_type = 'adjustment_increase'
    AND reference_type = 'inventory_adjustment'
    AND quantity = 10;

  IF v_seen <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: expected 1 adjustment_increase movement, got %',
      v_seen;
  END IF;

  SELECT count(*) INTO v_seen
  FROM inventory_adjustments
  WHERE ingredient_id = v_id
    AND direction = 'increase'
    AND reason = 'opening_stock'
    AND quantity = 10
    AND stock_before = 0
    AND stock_after = 10
    AND created_by = v_actor;

  IF v_seen <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: expected 1 opening_stock adjustment row, got %',
      v_seen;
  END IF;

  RAISE NOTICE 'SCENARIO A PASS: owner opening 10 — stock=10, one ledger pair';

  -- ----------------------------------------------------------------------
  -- SCENARIO B: owner, opening qty = 0
  -- ----------------------------------------------------------------------
  SET LOCAL ROLE authenticated;

  v_result := create_ingredient(
    '__sql126_dry_run_b__',
    'kg',
    NULL,
    NULL,
    0,
    1.50,
    0,
    NULL
  );

  RESET ROLE;

  v_id := (v_result ->> 'id')::uuid;

  SELECT current_stock INTO v_stock
  FROM ingredients
  WHERE id = v_id;

  IF v_stock IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: current_stock % — expected 0',
      v_stock;
  END IF;

  SELECT count(*) INTO v_seen
  FROM stock_movements
  WHERE ingredient_id = v_id;

  IF v_seen <> 0 THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: expected no stock_movements, got %',
      v_seen;
  END IF;

  SELECT count(*) INTO v_seen
  FROM inventory_adjustments
  WHERE ingredient_id = v_id;

  IF v_seen <> 0 THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: expected no inventory_adjustments, got %',
      v_seen;
  END IF;

  RAISE NOTICE 'SCENARIO B PASS: owner opening 0 — card exists, no ledger';

  -- ----------------------------------------------------------------------
  -- SCENARIO C: partner, opening qty > 0 (same as A)
  -- ----------------------------------------------------------------------
  IF v_partner IS NULL THEN
    UPDATE profiles SET role = 'partner' WHERE auth_user_id = v_owner;
    v_flipped_owner_to_partner := true;
    v_actor := v_owner;
    RAISE NOTICE
      'SCENARIO C: no real partner row; flipped owner % to partner for this transaction',
      v_owner;
  ELSE
    v_actor := v_partner;
    RAISE NOTICE 'SCENARIO C: using real partner row %', v_partner;
  END IF;

  v_claims := json_build_object(
    'sub', v_actor::text,
    'role', 'authenticated'
  )::text;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);

  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'partner' THEN
    RESET ROLE;
    IF v_flipped_owner_to_partner THEN
      UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
    END IF;
    RAISE EXCEPTION
      'SCENARIO C FAIL: get_my_role() is % — expected partner.',
      get_my_role();
  END IF;

  BEGIN
    v_result := create_ingredient(
      '__sql126_dry_run_c__',
      'L',
      NULL,
      NULL,
      0,
      2.00,
      7,
      'sql126 scenario C'
    );
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      IF v_flipped_owner_to_partner THEN
        UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
      END IF;
      RAISE EXCEPTION 'SCENARIO C FAIL: partner call raised: %', SQLERRM;
  END;

  RESET ROLE;

  IF v_flipped_owner_to_partner THEN
    UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
    v_flipped_owner_to_partner := false;
  END IF;

  v_id := (v_result ->> 'id')::uuid;

  SELECT current_stock INTO v_stock
  FROM ingredients
  WHERE id = v_id;

  IF v_stock IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: current_stock % — expected 7',
      v_stock;
  END IF;

  SELECT count(*) INTO v_seen
  FROM stock_movements
  WHERE ingredient_id = v_id
    AND movement_type = 'adjustment_increase'
    AND quantity = 7;

  IF v_seen <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: expected 1 adjustment_increase, got %',
      v_seen;
  END IF;

  SELECT count(*) INTO v_seen
  FROM inventory_adjustments
  WHERE ingredient_id = v_id
    AND reason = 'opening_stock'
    AND quantity = 7
    AND created_by = v_actor;

  IF v_seen <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: expected 1 opening_stock row for partner, got %',
      v_seen;
  END IF;

  RAISE NOTICE 'SCENARIO C PASS: partner opening 7';

  -- ----------------------------------------------------------------------
  -- SCENARIO D: seller — 42501, nothing inserted
  -- ----------------------------------------------------------------------
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_owner;

  v_actor := v_owner;
  v_claims := json_build_object(
    'sub', v_actor::text,
    'role', 'authenticated'
  )::text;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);

  SELECT count(*) INTO v_ing_before FROM ingredients;
  SELECT count(*) INTO v_adj_before FROM inventory_adjustments;
  SELECT count(*) INTO v_mov_before FROM stock_movements;

  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'seller' THEN
    RESET ROLE;
    UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
    RAISE EXCEPTION
      'SCENARIO D FAIL: flip did not stick (get_my_role=%)',
      get_my_role();
  END IF;

  BEGIN
    v_result := create_ingredient(
      '__sql126_dry_run_d__',
      'kg',
      NULL,
      NULL,
      0,
      1.00,
      3,
      'sql126 scenario D should fail'
    );
    RESET ROLE;
    UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
    RAISE EXCEPTION
      'SCENARIO D FAIL: seller-role caller unexpectedly succeeded (%)',
      v_result;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      v_sqlstate := SQLSTATE;
      IF v_err LIKE 'SCENARIO D FAIL:%' THEN
        RAISE;
      END IF;
      IF v_sqlstate IS DISTINCT FROM '42501'
         OR v_err NOT LIKE
           'Insufficient permissions for this action (role: seller).' THEN
        RESET ROLE;
        UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
        RAISE EXCEPTION
          'SCENARIO D FAIL: expected 42501 / role: seller, got SQLSTATE % / %',
          v_sqlstate, v_err;
      END IF;
      RAISE NOTICE
        'SCENARIO D PASS (seller rejected): SQLSTATE=% %',
        v_sqlstate, v_err;
  END;

  RESET ROLE;
  UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;

  SELECT count(*) INTO v_ing_after FROM ingredients;
  SELECT count(*) INTO v_adj_after FROM inventory_adjustments;
  SELECT count(*) INTO v_mov_after FROM stock_movements;

  IF v_ing_after IS DISTINCT FROM v_ing_before
     OR v_adj_after IS DISTINCT FROM v_adj_before
     OR v_mov_after IS DISTINCT FROM v_mov_before THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: a row was written (ingredients %->%, adjustments %->%, movements %->%)',
      v_ing_before, v_ing_after, v_adj_before, v_adj_after,
      v_mov_before, v_mov_after;
  END IF;

  IF EXISTS (
    SELECT 1 FROM ingredients WHERE name = '__sql126_dry_run_d__'
  ) THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: seller ingredient row exists';
  END IF;

  RAISE NOTICE 'sql/126 dry run: all 4 scenarios passed';
END;
$test$;

ROLLBACK;
-- <<< DRY RUN END

-- ============================================================================
-- PART 2 of 2 — THE MIGRATION (apply this for real, after Part 1 has passed
-- and after explicit approval). Same objects as the dry-run block.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_ingredient(
  p_name text,
  p_unit text,
  p_category_id uuid DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_minimum_stock numeric DEFAULT 0,
  p_cost_per_unit numeric DEFAULT 0,
  p_opening_quantity numeric DEFAULT 0,
  p_opening_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := btrim(COALESCE(p_name, ''));
  v_unit text := btrim(COALESCE(p_unit, ''));
  v_opening numeric(12, 3) := COALESCE(p_opening_quantity, 0);
  v_minimum numeric(12, 3) := COALESCE(p_minimum_stock, 0);
  v_cost numeric(12, 2) := COALESCE(p_cost_per_unit, 0);
  v_row ingredients%ROWTYPE;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF v_name = '' THEN
    RAISE EXCEPTION 'Ingredient name is required.';
  END IF;

  IF v_unit = '' THEN
    RAISE EXCEPTION 'Ingredient unit is required.';
  END IF;

  IF v_opening < 0 THEN
    RAISE EXCEPTION 'Opening stock must be 0 or greater.';
  END IF;

  IF v_minimum < 0 THEN
    RAISE EXCEPTION 'Minimum stock must be 0 or greater.';
  END IF;

  IF v_cost < 0 THEN
    RAISE EXCEPTION 'Cost per unit must be 0 or greater.';
  END IF;

  INSERT INTO ingredients (
    name,
    category_id,
    supplier_id,
    unit,
    current_stock,
    minimum_stock,
    cost_per_unit
  )
  VALUES (
    v_name,
    p_category_id,
    p_supplier_id,
    v_unit,
    0,
    v_minimum,
    v_cost
  )
  RETURNING * INTO v_row;

  IF v_opening > 0 THEN
    PERFORM record_inventory_adjustment(
      v_row.id,
      'increase',
      v_opening,
      'opening_stock',
      p_opening_note
    );

    SELECT *
    INTO v_row
    FROM ingredients
    WHERE id = v_row.id;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

COMMENT ON FUNCTION create_ingredient(
  text, text, uuid, uuid, numeric, numeric, numeric, text
) IS
  'Creates an ingredient at current_stock = 0, then records opening stock through record_inventory_adjustment when qty > 0. No movement when opening is 0. Never changes cost_per_unit after insert. Requires owner/partner. Does not post journals. Does not enforce unique names.';

REVOKE ALL ON FUNCTION create_ingredient(
  text, text, uuid, uuid, numeric, numeric, numeric, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_ingredient(
  text, text, uuid, uuid, numeric, numeric, numeric, text
) FROM anon;
GRANT EXECUTE ON FUNCTION create_ingredient(
  text, text, uuid, uuid, numeric, numeric, numeric, text
) TO authenticated;
