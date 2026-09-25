-- Inventory adjustment: two-way stock correction with an audit row.
--
-- Run in Supabase SQL editor after sql/124_ingredients_rls_role_guard.sql.
-- Do NOT apply to a live database until explicitly approved. This file is
-- a self-rolling-back dry run + the later apply script.
--
-- Why this exists:
--   IngredientModal Add/Edit writes ingredients.current_stock (and
--   cost_per_unit) through inventoryService.updateIngredient — a silent
--   overwrite with no stock_movements row. Adjust Stock replaces that
--   path for quantity: a real ledger event, owner/partner only.
--
-- Adds:
--   inventory_adjustments table
--   record_inventory_adjustment(...) SECURITY DEFINER
--   stock_movements.movement_type += adjustment_increase / adjustment_decrease
--     (reserved 'adjustment' is kept; quantity stays > 0; direction lives
--     in the type name, same as purchase_in / waste_out)
--   stock_movements.reference_type += inventory_adjustment
--     ('manual' already exists and is a different meaning — not reused)
--   BEFORE UPDATE trigger on ingredients that rejects current_stock /
--     cost_per_unit changes when current_user = 'authenticated'
--
-- Physical stock:
--   increase -> increment_ingredient_stock (sql/001, require_role added
--              in sql/098). Signature (uuid, numeric) fits. Does not
--              touch cost_per_unit.
--   decrease -> decrement_ingredient_stock (sql/007) after an explicit
--              below-zero guard in this RPC (decrement has its own
--              "Insufficient stock" check; this RPC raises a clearer
--              adjustment message first).
--   cost_per_unit is NEVER written by this RPC.
--
-- Role: PERFORM require_role('owner', 'partner') is the first statement.
--
-- Journal posting is NOT in this RPC (same as record_write_off). Future
-- inventory_adjusted posting stays Phase 2.
--
-- Does NOT:
--   - change increment_ingredient_stock / decrement_ingredient_stock
--   - write journal_entries / ledger_entries / transactions
--   - add a sidebar module or any TS/UI (Part B)
--   - treat write-offs as the same event (waste_out stays decrease-only
--     physical waste; this is count / typo / opening stock)
--   - create, delete, or modify any real Auth user or profiles row
--     outside the dry run's own BEGIN...ROLLBACK block
--
-- ============================================================================
-- cost_per_unit / current_stock lock (companion, same file)
-- ============================================================================
--
-- Decision: enforce at the database level now, not only in Part B TS/UI.
--
-- Mechanism: BEFORE UPDATE trigger on ingredients. If current_user is
-- 'authenticated' AND (current_stock OR cost_per_unit) actually changed,
-- raise 42501. Same-value UPDATE (Edit Save of Name/Category/Unit/
-- Minimum Stock that still sends the existing qty/cost) is allowed —
-- IS DISTINCT FROM is false, trigger is a no-op.
--
-- Why a trigger, not column-level GRANT:
--   Column GRANT needs an explicit list of every other updatable column
--   and a new GRANT each time ingredients grows. A trigger keys off
--   current_user and the two columns only.
-- Why current_user = 'authenticated', not a session GUC:
--   Approved writers (receive_purchase, confirm_sale,
--   complete_production_session, record_write_off, this RPC) are
--   SECURITY DEFINER. Nested INVOKER helpers
--   (increment_ingredient_stock, decrement_ingredient_stock,
--   receive_purchase_line_stock_and_cost) inherit the DEFINER
--   current_user (postgres / table owner), not 'authenticated'.
--   inventoryService.updateIngredient is PostgREST as authenticated.
--   No GUC to thread through every existing stock RPC.
--
-- INSERT is not blocked. createIngredient may still set opening
-- current_stock / cost_per_unit. Part B routes a non-zero opening
-- qty through this RPC; until then, Add remains the one silent write.
--
-- Between Part A apply and Part B UI: Edit Save of master data still
-- works when qty/cost are unchanged. Changing qty/cost in the old
-- form will 42501 — that is the intended lock, not a regression to
-- paper over in Part A.
--
-- ============================================================================
-- PART 1 of 2 — DRY RUN (BEGIN...ROLLBACK). Copy everything between
-- "-- >>> DRY RUN START" and "-- <<< DRY RUN END" into the SQL Editor
-- and run it FIRST. Nothing persists.
--
--   (A) owner  increase — stock += qty, cost unchanged, both rows exist
--   (B) owner  decrease with enough stock — stock -= qty, cost unchanged
--   (C) owner  decrease greater than stock — RAISE, nothing written
--   (D) partner (real row or temporary flip) increase succeeds
--   (E) seller (temporary flip) 42501 / Insufficient permissions,
--       nothing written
--   (F) companion trigger: authenticated owner cannot UPDATE
--       current_stock or cost_per_unit; master-data UPDATE still works
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (
    movement_type IN (
      'purchase_in',
      'sale_out',
      'production_in',
      'production_out',
      'waste_out',
      'transfer_in',
      'transfer_out',
      'adjustment',
      'adjustment_increase',
      'adjustment_decrease'
    )
  );

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_reference_type_check
  CHECK (
    reference_type IN (
      'purchase',
      'sale',
      'production_order',
      'production_session',
      'stock_movement',
      'payment',
      'manual',
      'event',
      'write_off',
      'inventory_adjustment'
    )
  );

CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id uuid NOT NULL REFERENCES ingredients (id),
  direction text NOT NULL
    CHECK (direction IN ('increase', 'decrease')),
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(12, 4) NOT NULL DEFAULT 0,
  stock_before numeric(12, 3) NOT NULL,
  stock_after numeric(12, 3) NOT NULL CHECK (stock_after >= 0),
  reason text NOT NULL
    CHECK (
      reason IN (
        'opening_stock',
        'physical_count',
        'data_entry_correction',
        'other'
      )
    ),
  note text,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_adjustments_stock_math_chk CHECK (
    (
      direction = 'increase'
      AND stock_after = stock_before + quantity
    )
    OR (
      direction = 'decrease'
      AND stock_after = stock_before - quantity
    )
  )
);

CREATE INDEX IF NOT EXISTS inventory_adjustments_created_at_idx
  ON inventory_adjustments (created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_adjustments_ingredient_id_idx
  ON inventory_adjustments (ingredient_id);
CREATE INDEX IF NOT EXISTS inventory_adjustments_reason_idx
  ON inventory_adjustments (reason);

COMMENT ON TABLE inventory_adjustments IS
  'Immutable two-way raw-material stock corrections (count, typo, opening). Stock mutation is owned by record_inventory_adjustment. cost_per_unit is never changed. Journals are not posted here.';

ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_adjustments_authenticated_select
  ON inventory_adjustments;
DROP POLICY IF EXISTS inventory_adjustments_owner_partner_insert
  ON inventory_adjustments;

CREATE POLICY inventory_adjustments_authenticated_select
  ON inventory_adjustments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY inventory_adjustments_owner_partner_insert
  ON inventory_adjustments
  FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

REVOKE ALL ON TABLE inventory_adjustments FROM PUBLIC;
REVOKE ALL ON TABLE inventory_adjustments FROM anon;
GRANT SELECT, INSERT ON inventory_adjustments TO authenticated;

CREATE OR REPLACE FUNCTION record_inventory_adjustment(
  p_ingredient_id uuid,
  p_direction text,
  p_quantity numeric,
  p_reason text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_name text;
  v_stock_before numeric(12, 3);
  v_stock_after numeric(12, 3);
  v_unit_cost numeric(12, 4);
  v_cost_after numeric(12, 4);
  v_movement_id uuid;
  v_movement_type text;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_ingredient_id IS NULL THEN
    RAISE EXCEPTION 'Ingredient id is required.';
  END IF;

  IF p_direction IS NULL OR p_direction NOT IN ('increase', 'decrease') THEN
    RAISE EXCEPTION
      'Inventory adjustment direction must be increase or decrease.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION
      'Inventory adjustment quantity must be greater than zero.';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN (
    'opening_stock',
    'physical_count',
    'data_entry_correction',
    'other'
  ) THEN
    RAISE EXCEPTION 'Inventory adjustment reason is invalid.';
  END IF;

  SELECT
    name,
    current_stock,
    COALESCE(cost_per_unit, 0)
  INTO v_name, v_stock_before, v_unit_cost
  FROM ingredients
  WHERE id = p_ingredient_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found: %', p_ingredient_id;
  END IF;

  IF p_direction = 'decrease' THEN
    IF v_stock_before < p_quantity THEN
      RAISE EXCEPTION
        'Cannot decrease stock below zero for "%". Requested %, available %.',
        COALESCE(v_name, 'ingredient'),
        round(p_quantity, 3),
        round(v_stock_before, 3);
    END IF;
    PERFORM decrement_ingredient_stock(p_ingredient_id, p_quantity);
    v_movement_type := 'adjustment_decrease';
  ELSE
    PERFORM increment_ingredient_stock(p_ingredient_id, p_quantity);
    v_movement_type := 'adjustment_increase';
  END IF;

  SELECT current_stock, COALESCE(cost_per_unit, 0)
  INTO v_stock_after, v_cost_after
  FROM ingredients
  WHERE id = p_ingredient_id;

  IF v_cost_after IS DISTINCT FROM v_unit_cost THEN
    RAISE EXCEPTION
      'record_inventory_adjustment must never change cost_per_unit.';
  END IF;

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
    p_ingredient_id,
    NULL,
    v_movement_type,
    p_quantity,
    v_unit_cost,
    NULL,
    'inventory_adjustment',
    v_id,
    v_now,
    v_now
  )
  RETURNING id INTO v_movement_id;

  INSERT INTO inventory_adjustments (
    id,
    ingredient_id,
    direction,
    quantity,
    unit_cost,
    stock_before,
    stock_after,
    reason,
    note,
    created_by,
    created_at
  )
  VALUES (
    v_id,
    p_ingredient_id,
    p_direction,
    p_quantity,
    v_unit_cost,
    v_stock_before,
    v_stock_after,
    p_reason,
    v_note,
    auth.uid(),
    v_now
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'movement_id', v_movement_id,
    'current_stock', v_stock_after
  );
END;
$$;

REVOKE ALL ON FUNCTION record_inventory_adjustment(
  uuid, text, numeric, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_inventory_adjustment(
  uuid, text, numeric, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION record_inventory_adjustment(
  uuid, text, numeric, text, text
) TO authenticated;

CREATE OR REPLACE FUNCTION protect_ingredient_qty_cost_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND (
       NEW.current_stock IS DISTINCT FROM OLD.current_stock
       OR NEW.cost_per_unit IS DISTINCT FROM OLD.cost_per_unit
     ) THEN
    RAISE EXCEPTION
      'current_stock and cost_per_unit can only be changed through approved stock RPCs.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ingredients_protect_qty_cost ON ingredients;

CREATE TRIGGER ingredients_protect_qty_cost
  BEFORE UPDATE ON ingredients
  FOR EACH ROW
  EXECUTE FUNCTION protect_ingredient_qty_cost_columns();

DO $test$
DECLARE
  v_owner uuid;
  v_partner uuid;
  v_actor uuid;
  v_partner_original_role text;
  v_flipped_owner_to_partner boolean := false;
  v_claims text;
  v_ingredient uuid;
  v_stock_before numeric;
  v_stock_after numeric;
  v_cost_before numeric;
  v_cost_after numeric;
  v_result jsonb;
  v_adj_id uuid;
  v_movement_id uuid;
  v_seen integer;
  v_adj_count_before integer;
  v_mov_count_before integer;
  v_adj_count_after integer;
  v_mov_count_after integer;
  v_err text;
  v_sqlstate text;
  v_updated integer;
  v_min_before numeric;
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

  SELECT p.auth_user_id, p.role
  INTO v_partner, v_partner_original_role
  FROM profiles p
  WHERE p.is_active = true
    AND p.role = 'partner'
    AND p.auth_user_id IS DISTINCT FROM v_owner
  ORDER BY p.auth_user_id
  LIMIT 1;

  -- Dedicated throwaway row with known qty/cost. Always insert (rolled
  -- back). Do not reuse an existing ingredient — decrease tests need a
  -- known on-hand quantity, and CI may have an empty ingredients table
  -- (sql/124 seed lives only inside its own ROLLBACK).
  BEGIN
    INSERT INTO ingredients (
      name,
      unit,
      current_stock,
      minimum_stock,
      cost_per_unit
    )
    VALUES (
      '__sql125_dry_run_seed__',
      'kg',
      20,
      0,
      4.25
    )
    RETURNING id, current_stock, cost_per_unit
    INTO v_ingredient, v_stock_before, v_cost_before;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION
        'No ingredients row — cannot exercise record_inventory_adjustment. Seed insert failed: %',
        SQLERRM;
  END;

  IF v_ingredient IS NULL THEN
    RAISE EXCEPTION
      'No ingredients row — cannot exercise record_inventory_adjustment.';
  END IF;

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
  -- SCENARIO A: owner increase
  -- ----------------------------------------------------------------------
  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'owner' THEN
    RESET ROLE;
    RAISE EXCEPTION
      'SCENARIO A FAIL: get_my_role() is % — expected owner.',
      get_my_role();
  END IF;

  v_result := record_inventory_adjustment(
    v_ingredient,
    'increase',
    5,
    'physical_count',
    'sql125 scenario A'
  );

  SELECT count(*) INTO v_seen
  FROM inventory_adjustments
  WHERE id = (v_result ->> 'id')::uuid;

  RESET ROLE;

  IF v_result IS NULL
     OR v_result ->> 'id' IS NULL
     OR v_result ->> 'movement_id' IS NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: RPC returned incomplete jsonb %', v_result;
  END IF;

  IF v_seen <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: authenticated SELECT missed inventory_adjustments (count=%)',
      v_seen;
  END IF;

  SELECT current_stock, cost_per_unit
  INTO v_stock_after, v_cost_after
  FROM ingredients
  WHERE id = v_ingredient;

  IF v_stock_after IS DISTINCT FROM (v_stock_before + 5) THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: current_stock % — expected %',
      v_stock_after, v_stock_before + 5;
  END IF;

  IF (v_result ->> 'current_stock')::numeric IS DISTINCT FROM v_stock_after THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: returned current_stock % — table has %',
      v_result ->> 'current_stock', v_stock_after;
  END IF;

  IF v_cost_after IS DISTINCT FROM v_cost_before THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: cost_per_unit changed (% -> %)',
      v_cost_before, v_cost_after;
  END IF;

  v_adj_id := (v_result ->> 'id')::uuid;
  v_movement_id := (v_result ->> 'movement_id')::uuid;

  IF NOT EXISTS (
    SELECT 1
    FROM stock_movements sm
    WHERE sm.id = v_movement_id
      AND sm.ingredient_id = v_ingredient
      AND sm.movement_type = 'adjustment_increase'
      AND sm.quantity = 5
      AND sm.unit_cost IS NOT DISTINCT FROM v_cost_before
      AND sm.reference_type = 'inventory_adjustment'
      AND sm.reference_id = v_adj_id
  ) THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: stock_movements row missing or wrong';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM inventory_adjustments ia
    WHERE ia.id = v_adj_id
      AND ia.ingredient_id = v_ingredient
      AND ia.direction = 'increase'
      AND ia.quantity = 5
      AND ia.unit_cost IS NOT DISTINCT FROM v_cost_before
      AND ia.stock_before = v_stock_before
      AND ia.stock_after = v_stock_after
      AND ia.reason = 'physical_count'
      AND ia.note = 'sql125 scenario A'
      AND ia.created_by = v_owner
  ) THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: inventory_adjustments row missing or wrong';
  END IF;

  RAISE NOTICE
    'SCENARIO A PASS: owner increase 20+5=25, cost unchanged, both rows written';

  v_stock_before := v_stock_after;

  -- ----------------------------------------------------------------------
  -- SCENARIO B: owner decrease with enough stock
  -- ----------------------------------------------------------------------
  SET LOCAL ROLE authenticated;

  v_result := record_inventory_adjustment(
    v_ingredient,
    'decrease',
    3,
    'data_entry_correction',
    NULL
  );

  RESET ROLE;

  SELECT current_stock, cost_per_unit
  INTO v_stock_after, v_cost_after
  FROM ingredients
  WHERE id = v_ingredient;

  IF v_stock_after IS DISTINCT FROM (v_stock_before - 3) THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: current_stock % — expected %',
      v_stock_after, v_stock_before - 3;
  END IF;

  IF v_cost_after IS DISTINCT FROM v_cost_before THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: cost_per_unit changed (% -> %)',
      v_cost_before, v_cost_after;
  END IF;

  v_adj_id := (v_result ->> 'id')::uuid;
  v_movement_id := (v_result ->> 'movement_id')::uuid;

  IF NOT EXISTS (
    SELECT 1
    FROM stock_movements sm
    WHERE sm.id = v_movement_id
      AND sm.movement_type = 'adjustment_decrease'
      AND sm.quantity = 3
      AND sm.reference_type = 'inventory_adjustment'
      AND sm.reference_id = v_adj_id
      AND sm.unit_cost IS NOT DISTINCT FROM v_cost_before
  ) THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: stock_movements row missing or wrong';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM inventory_adjustments ia
    WHERE ia.id = v_adj_id
      AND ia.direction = 'decrease'
      AND ia.quantity = 3
      AND ia.stock_before = v_stock_before
      AND ia.stock_after = v_stock_after
      AND ia.reason = 'data_entry_correction'
      AND ia.note IS NULL
      AND ia.created_by = v_owner
  ) THEN
    RAISE EXCEPTION
      'SCENARIO B FAIL: inventory_adjustments row missing or wrong';
  END IF;

  RAISE NOTICE
    'SCENARIO B PASS: owner decrease, cost unchanged, both rows written';

  v_stock_before := v_stock_after;

  -- ----------------------------------------------------------------------
  -- SCENARIO C: decrease greater than stock — RAISE, no writes
  -- ----------------------------------------------------------------------
  SELECT count(*) INTO v_adj_count_before
  FROM inventory_adjustments
  WHERE ingredient_id = v_ingredient;

  SELECT count(*) INTO v_mov_count_before
  FROM stock_movements
  WHERE ingredient_id = v_ingredient
    AND reference_type = 'inventory_adjustment';

  SET LOCAL ROLE authenticated;

  BEGIN
    v_result := record_inventory_adjustment(
      v_ingredient,
      'decrease',
      v_stock_before + 1,
      'physical_count',
      'sql125 scenario C should fail'
    );
    RESET ROLE;
    RAISE EXCEPTION
      'SCENARIO C FAIL: oversize decrease unexpectedly succeeded (%)',
      v_result;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO C FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE 'Cannot decrease stock below zero%' THEN
        RESET ROLE;
        RAISE EXCEPTION
          'SCENARIO C FAIL: expected below-zero guard, got: %',
          v_err;
      END IF;
      RAISE NOTICE 'SCENARIO C PASS (below-zero rejected): %', v_err;
  END;

  RESET ROLE;

  SELECT current_stock, cost_per_unit
  INTO v_stock_after, v_cost_after
  FROM ingredients
  WHERE id = v_ingredient;

  SELECT count(*) INTO v_adj_count_after
  FROM inventory_adjustments
  WHERE ingredient_id = v_ingredient;

  SELECT count(*) INTO v_mov_count_after
  FROM stock_movements
  WHERE ingredient_id = v_ingredient
    AND reference_type = 'inventory_adjustment';

  IF v_stock_after IS DISTINCT FROM v_stock_before THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: current_stock changed after rejected decrease (% -> %)',
      v_stock_before, v_stock_after;
  END IF;

  IF v_cost_after IS DISTINCT FROM v_cost_before THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: cost_per_unit changed after rejected decrease';
  END IF;

  IF v_adj_count_after IS DISTINCT FROM v_adj_count_before THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: inventory_adjustments count % -> %',
      v_adj_count_before, v_adj_count_after;
  END IF;

  IF v_mov_count_after IS DISTINCT FROM v_mov_count_before THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: stock_movements count % -> %',
      v_mov_count_before, v_mov_count_after;
  END IF;

  -- ----------------------------------------------------------------------
  -- SCENARIO D: partner increase
  -- ----------------------------------------------------------------------
  IF v_partner IS NULL THEN
    UPDATE profiles SET role = 'partner' WHERE auth_user_id = v_owner;
    v_flipped_owner_to_partner := true;
    v_actor := v_owner;
    RAISE NOTICE
      'SCENARIO D: no real partner row; flipped owner % to partner for this transaction',
      v_owner;
  ELSE
    v_actor := v_partner;
    RAISE NOTICE 'SCENARIO D: using real partner row %', v_partner;
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
      'SCENARIO D FAIL: get_my_role() is % — expected partner.',
      get_my_role();
  END IF;

  BEGIN
    v_result := record_inventory_adjustment(
      v_ingredient,
      'increase',
      1,
      'other',
      'sql125 scenario D'
    );
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      IF v_flipped_owner_to_partner THEN
        UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
      END IF;
      RAISE EXCEPTION 'SCENARIO D FAIL: partner call raised: %', SQLERRM;
  END;

  RESET ROLE;

  IF v_flipped_owner_to_partner THEN
    UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
    v_flipped_owner_to_partner := false;
  END IF;

  SELECT current_stock, cost_per_unit
  INTO v_stock_after, v_cost_after
  FROM ingredients
  WHERE id = v_ingredient;

  IF v_stock_after IS DISTINCT FROM (v_stock_before + 1) THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: current_stock % — expected %',
      v_stock_after, v_stock_before + 1;
  END IF;

  IF v_cost_after IS DISTINCT FROM v_cost_before THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: cost_per_unit changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM inventory_adjustments ia
    WHERE ia.id = (v_result ->> 'id')::uuid
      AND ia.direction = 'increase'
      AND ia.quantity = 1
      AND ia.created_by = v_actor
  ) THEN
    RAISE EXCEPTION
      'SCENARIO D FAIL: inventory_adjustments row missing or created_by != partner actor';
  END IF;

  RAISE NOTICE 'SCENARIO D PASS: partner increase succeeded';

  v_stock_before := v_stock_after;

  -- ----------------------------------------------------------------------
  -- SCENARIO E: seller (flip owner) — 42501 before any write
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

  SELECT count(*) INTO v_adj_count_before
  FROM inventory_adjustments
  WHERE ingredient_id = v_ingredient;

  SELECT count(*) INTO v_mov_count_before
  FROM stock_movements
  WHERE ingredient_id = v_ingredient
    AND reference_type = 'inventory_adjustment';

  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'seller' THEN
    RESET ROLE;
    UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
    RAISE EXCEPTION
      'SCENARIO E FAIL: flip did not stick (get_my_role=%)',
      get_my_role();
  END IF;

  BEGIN
    v_result := record_inventory_adjustment(
      v_ingredient,
      'decrease',
      1,
      'physical_count',
      'sql125 scenario E should fail'
    );
    RESET ROLE;
    UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
    RAISE EXCEPTION
      'SCENARIO E FAIL: seller-role caller unexpectedly succeeded (%)',
      v_result;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      v_sqlstate := SQLSTATE;
      IF v_err LIKE 'SCENARIO E FAIL:%' THEN
        RAISE;
      END IF;
      IF v_sqlstate IS DISTINCT FROM '42501'
         OR v_err NOT LIKE
           'Insufficient permissions for this action (role: seller).' THEN
        RESET ROLE;
        UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;
        RAISE EXCEPTION
          'SCENARIO E FAIL: expected 42501 / role: seller, got SQLSTATE % / %',
          v_sqlstate, v_err;
      END IF;
      RAISE NOTICE
        'SCENARIO E PASS (seller rejected): SQLSTATE=% %',
        v_sqlstate, v_err;
  END;

  RESET ROLE;
  UPDATE profiles SET role = 'owner' WHERE auth_user_id = v_owner;

  SELECT current_stock, cost_per_unit
  INTO v_stock_after, v_cost_after
  FROM ingredients
  WHERE id = v_ingredient;

  SELECT count(*) INTO v_adj_count_after
  FROM inventory_adjustments
  WHERE ingredient_id = v_ingredient;

  SELECT count(*) INTO v_mov_count_after
  FROM stock_movements
  WHERE ingredient_id = v_ingredient
    AND reference_type = 'inventory_adjustment';

  IF v_stock_after IS DISTINCT FROM v_stock_before THEN
    RAISE EXCEPTION
      'SCENARIO E FAIL: current_stock changed after rejected seller call';
  END IF;

  IF v_cost_after IS DISTINCT FROM v_cost_before THEN
    RAISE EXCEPTION
      'SCENARIO E FAIL: cost_per_unit changed after rejected seller call';
  END IF;

  IF v_adj_count_after IS DISTINCT FROM v_adj_count_before
     OR v_mov_count_after IS DISTINCT FROM v_mov_count_before THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: a new ledger row was written';
  END IF;

  -- Restore owner JWT for the companion trigger check.
  v_actor := v_owner;
  v_claims := json_build_object(
    'sub', v_actor::text,
    'role', 'authenticated'
  )::text;
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);

  -- ----------------------------------------------------------------------
  -- SCENARIO F: companion trigger — qty/cost locked for authenticated
  -- ----------------------------------------------------------------------
  SELECT minimum_stock INTO v_min_before
  FROM ingredients
  WHERE id = v_ingredient;

  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE ingredients
    SET current_stock = current_stock + 1
    WHERE id = v_ingredient;
    RESET ROLE;
    RAISE EXCEPTION
      'SCENARIO F FAIL: authenticated UPDATE of current_stock succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      v_sqlstate := SQLSTATE;
      IF v_err LIKE 'SCENARIO F FAIL:%' THEN
        RAISE;
      END IF;
      IF v_sqlstate IS DISTINCT FROM '42501'
         OR v_err NOT LIKE
           'current_stock and cost_per_unit can only be changed through approved stock RPCs.' THEN
        RESET ROLE;
        RAISE EXCEPTION
          'SCENARIO F FAIL: current_stock UPDATE expected 42501 lock, got SQLSTATE % / %',
          v_sqlstate, v_err;
      END IF;
      RAISE NOTICE 'SCENARIO F PASS (current_stock UPDATE rejected): %', v_err;
  END;

  BEGIN
    UPDATE ingredients
    SET cost_per_unit = cost_per_unit + 1
    WHERE id = v_ingredient;
    RESET ROLE;
    RAISE EXCEPTION
      'SCENARIO F FAIL: authenticated UPDATE of cost_per_unit succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      v_sqlstate := SQLSTATE;
      IF v_err LIKE 'SCENARIO F FAIL:%' THEN
        RAISE;
      END IF;
      IF v_sqlstate IS DISTINCT FROM '42501' THEN
        RESET ROLE;
        RAISE EXCEPTION
          'SCENARIO F FAIL: cost_per_unit UPDATE expected 42501, got SQLSTATE % / %',
          v_sqlstate, v_err;
      END IF;
      RAISE NOTICE 'SCENARIO F PASS (cost_per_unit UPDATE rejected): %', v_err;
  END;

  UPDATE ingredients
  SET minimum_stock = minimum_stock
  WHERE id = v_ingredient;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RESET ROLE;

  IF v_updated <> 1 THEN
    RAISE EXCEPTION
      'SCENARIO F FAIL: master-data UPDATE row_count=% (expected 1)',
      v_updated;
  END IF;

  SELECT current_stock, cost_per_unit, minimum_stock
  INTO v_stock_after, v_cost_after, v_min_before
  FROM ingredients
  WHERE id = v_ingredient;

  IF v_stock_after IS DISTINCT FROM v_stock_before THEN
    RAISE EXCEPTION
      'SCENARIO F FAIL: current_stock changed after rejected authenticated UPDATEs';
  END IF;

  IF v_cost_after IS DISTINCT FROM v_cost_before THEN
    RAISE EXCEPTION
      'SCENARIO F FAIL: cost_per_unit changed after rejected authenticated UPDATEs';
  END IF;

  RAISE NOTICE
    'SCENARIO F PASS: qty/cost locked for authenticated; master-data UPDATE allowed';

  RAISE NOTICE 'sql/125 dry run: all 6 scenarios passed';
END;
$test$;

ROLLBACK;
-- <<< DRY RUN END

-- ============================================================================
-- PART 2 of 2 — THE MIGRATION (apply this for real, after Part 1 has passed
-- and after explicit approval). Same objects as the dry-run block.
-- ============================================================================

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_movement_type_check;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_movement_type_check
  CHECK (
    movement_type IN (
      'purchase_in',
      'sale_out',
      'production_in',
      'production_out',
      'waste_out',
      'transfer_in',
      'transfer_out',
      'adjustment',
      'adjustment_increase',
      'adjustment_decrease'
    )
  );

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_reference_type_check
  CHECK (
    reference_type IN (
      'purchase',
      'sale',
      'production_order',
      'production_session',
      'stock_movement',
      'payment',
      'manual',
      'event',
      'write_off',
      'inventory_adjustment'
    )
  );

CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id uuid NOT NULL REFERENCES ingredients (id),
  direction text NOT NULL
    CHECK (direction IN ('increase', 'decrease')),
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(12, 4) NOT NULL DEFAULT 0,
  stock_before numeric(12, 3) NOT NULL,
  stock_after numeric(12, 3) NOT NULL CHECK (stock_after >= 0),
  reason text NOT NULL
    CHECK (
      reason IN (
        'opening_stock',
        'physical_count',
        'data_entry_correction',
        'other'
      )
    ),
  note text,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_adjustments_stock_math_chk CHECK (
    (
      direction = 'increase'
      AND stock_after = stock_before + quantity
    )
    OR (
      direction = 'decrease'
      AND stock_after = stock_before - quantity
    )
  )
);

CREATE INDEX IF NOT EXISTS inventory_adjustments_created_at_idx
  ON inventory_adjustments (created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_adjustments_ingredient_id_idx
  ON inventory_adjustments (ingredient_id);
CREATE INDEX IF NOT EXISTS inventory_adjustments_reason_idx
  ON inventory_adjustments (reason);

COMMENT ON TABLE inventory_adjustments IS
  'Immutable two-way raw-material stock corrections (count, typo, opening). Stock mutation is owned by record_inventory_adjustment. cost_per_unit is never changed. Journals are not posted here.';

ALTER TABLE inventory_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_adjustments_authenticated_select
  ON inventory_adjustments;
DROP POLICY IF EXISTS inventory_adjustments_owner_partner_insert
  ON inventory_adjustments;

CREATE POLICY inventory_adjustments_authenticated_select
  ON inventory_adjustments
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY inventory_adjustments_owner_partner_insert
  ON inventory_adjustments
  FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

REVOKE ALL ON TABLE inventory_adjustments FROM PUBLIC;
REVOKE ALL ON TABLE inventory_adjustments FROM anon;
GRANT SELECT, INSERT ON inventory_adjustments TO authenticated;

CREATE OR REPLACE FUNCTION record_inventory_adjustment(
  p_ingredient_id uuid,
  p_direction text,
  p_quantity numeric,
  p_reason text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_name text;
  v_stock_before numeric(12, 3);
  v_stock_after numeric(12, 3);
  v_unit_cost numeric(12, 4);
  v_cost_after numeric(12, 4);
  v_movement_id uuid;
  v_movement_type text;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_ingredient_id IS NULL THEN
    RAISE EXCEPTION 'Ingredient id is required.';
  END IF;

  IF p_direction IS NULL OR p_direction NOT IN ('increase', 'decrease') THEN
    RAISE EXCEPTION
      'Inventory adjustment direction must be increase or decrease.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION
      'Inventory adjustment quantity must be greater than zero.';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN (
    'opening_stock',
    'physical_count',
    'data_entry_correction',
    'other'
  ) THEN
    RAISE EXCEPTION 'Inventory adjustment reason is invalid.';
  END IF;

  SELECT
    name,
    current_stock,
    COALESCE(cost_per_unit, 0)
  INTO v_name, v_stock_before, v_unit_cost
  FROM ingredients
  WHERE id = p_ingredient_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found: %', p_ingredient_id;
  END IF;

  IF p_direction = 'decrease' THEN
    IF v_stock_before < p_quantity THEN
      RAISE EXCEPTION
        'Cannot decrease stock below zero for "%". Requested %, available %.',
        COALESCE(v_name, 'ingredient'),
        round(p_quantity, 3),
        round(v_stock_before, 3);
    END IF;
    PERFORM decrement_ingredient_stock(p_ingredient_id, p_quantity);
    v_movement_type := 'adjustment_decrease';
  ELSE
    PERFORM increment_ingredient_stock(p_ingredient_id, p_quantity);
    v_movement_type := 'adjustment_increase';
  END IF;

  SELECT current_stock, COALESCE(cost_per_unit, 0)
  INTO v_stock_after, v_cost_after
  FROM ingredients
  WHERE id = p_ingredient_id;

  IF v_cost_after IS DISTINCT FROM v_unit_cost THEN
    RAISE EXCEPTION
      'record_inventory_adjustment must never change cost_per_unit.';
  END IF;

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
    p_ingredient_id,
    NULL,
    v_movement_type,
    p_quantity,
    v_unit_cost,
    NULL,
    'inventory_adjustment',
    v_id,
    v_now,
    v_now
  )
  RETURNING id INTO v_movement_id;

  INSERT INTO inventory_adjustments (
    id,
    ingredient_id,
    direction,
    quantity,
    unit_cost,
    stock_before,
    stock_after,
    reason,
    note,
    created_by,
    created_at
  )
  VALUES (
    v_id,
    p_ingredient_id,
    p_direction,
    p_quantity,
    v_unit_cost,
    v_stock_before,
    v_stock_after,
    p_reason,
    v_note,
    auth.uid(),
    v_now
  );

  RETURN jsonb_build_object(
    'id', v_id,
    'movement_id', v_movement_id,
    'current_stock', v_stock_after
  );
END;
$$;

COMMENT ON FUNCTION record_inventory_adjustment(
  uuid, text, numeric, text, text
) IS
  'Two-way raw-material stock correction. increase uses increment_ingredient_stock; decrease uses decrement_ingredient_stock after a below-zero guard. Writes inventory_adjustments + adjustment_increase/adjustment_decrease. Never changes cost_per_unit. Does not post journals. Requires owner/partner.';

REVOKE ALL ON FUNCTION record_inventory_adjustment(
  uuid, text, numeric, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_inventory_adjustment(
  uuid, text, numeric, text, text
) FROM anon;
GRANT EXECUTE ON FUNCTION record_inventory_adjustment(
  uuid, text, numeric, text, text
) TO authenticated;

CREATE OR REPLACE FUNCTION protect_ingredient_qty_cost_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'authenticated'
     AND (
       NEW.current_stock IS DISTINCT FROM OLD.current_stock
       OR NEW.cost_per_unit IS DISTINCT FROM OLD.cost_per_unit
     ) THEN
    RAISE EXCEPTION
      'current_stock and cost_per_unit can only be changed through approved stock RPCs.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION protect_ingredient_qty_cost_columns() IS
  'BEFORE UPDATE on ingredients: authenticated clients cannot change current_stock or cost_per_unit. SECURITY DEFINER stock RPCs run as the function owner and are not blocked. INSERT (opening stock) is not blocked.';

DROP TRIGGER IF EXISTS ingredients_protect_qty_cost ON ingredients;

CREATE TRIGGER ingredients_protect_qty_cost
  BEFORE UPDATE ON ingredients
  FOR EACH ROW
  EXECUTE FUNCTION protect_ingredient_qty_cost_columns();
