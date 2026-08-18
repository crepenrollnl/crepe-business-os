-- Role Guard — Tranche 2 (Purchases + Production)
-- Builds on sql/097 (profiles, get_my_role, require_role).
--
-- Two layers, both required:
--   (a) require_role('owner','partner') inside the write RPCs used by
--       Purchases + Production, guarding the normal app flow.
--   (b) RLS policies on the underlying tables, because several of these
--       modules write via direct Supabase-client table access
--       (purchases/purchase_items/suppliers headers, production plan and
--       session CRUD), not through RPC — a role check inside an RPC alone
--       would not stop a direct REST call to the table.
--
-- Scope: Purchases + Production only (suppliers, purchases, purchase_items,
-- production_plans and its child tables, production_sessions and its child
-- table). Deliberately NOT touched in this migration: production_batches,
-- stock_movements, transactions, ingredients — these are shared with Sales
-- (confirm_sale is SECURITY DEFINER and bypasses RLS on them regardless,
-- so restricting them here would not affect Sales correctness, but a
-- Seller-facing read dependency on them has not been audited yet — left
-- for a future Sales-focused tranche).
--
-- Does NOT:
--   - change any table schema
--   - touch production_batches / stock_movements / transactions / ingredients RLS
--   - add role checks to read-only calculation RPCs (calculate_purchase_totals,
--     calculate_purchase_taxes) — no side effects, deferred

-- ---------------------------------------------------------------------------
-- RLS: restrict writes+reads on Purchases/Production tables to owner/partner
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS suppliers_authenticated_all ON suppliers;
CREATE POLICY suppliers_owner_partner_all
  ON suppliers
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS purchases_authenticated_all ON purchases;
CREATE POLICY purchases_owner_partner_all
  ON purchases
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS purchase_items_authenticated_all ON purchase_items;
CREATE POLICY purchase_items_owner_partner_all
  ON purchase_items
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS production_plans_authenticated_all ON production_plans;
CREATE POLICY production_plans_owner_partner_all
  ON production_plans
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS production_plan_products_authenticated_all ON production_plan_products;
CREATE POLICY production_plan_products_owner_partner_all
  ON production_plan_products
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS production_plan_ingredients_authenticated_all ON production_plan_ingredients;
CREATE POLICY production_plan_ingredients_owner_partner_all
  ON production_plan_ingredients
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS production_plan_shopping_items_authenticated_all ON production_plan_shopping_items;
CREATE POLICY production_plan_shopping_items_owner_partner_all
  ON production_plan_shopping_items
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS production_sessions_authenticated_all ON production_sessions;
CREATE POLICY production_sessions_owner_partner_all
  ON production_sessions
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS production_session_lines_authenticated_all ON production_session_lines;
CREATE POLICY production_session_lines_owner_partner_all
  ON production_session_lines
  FOR ALL
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

-- ---------------------------------------------------------------------------
-- RPC guards: PERFORM require_role('owner', 'partner') inserted as the
-- first statement of each function body. Every other line is byte-for-byte
-- identical to the current repository version — verify this in review.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_supplier(
  p_name text,
  p_contact_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_vat_number text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_contact_name text;
  v_email text;
  v_phone text;
  v_vat_number text;
  v_notes text;
  v_code text;
  v_supplier_id uuid;
  v_now timestamptz := now();
BEGIN
  PERFORM require_role('owner', 'partner');
  v_name := NULLIF(btrim(COALESCE(p_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Supplier name is required.';
  END IF;
  v_contact_name := NULLIF(btrim(COALESCE(p_contact_name, '')), '');
  v_email := NULLIF(btrim(COALESCE(p_email, '')), '');
  v_phone := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_vat_number := NULLIF(btrim(COALESCE(p_vat_number, '')), '');
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_code := 'V-' || lpad(nextval('suppliers_code_seq')::text, 6, '0');
  INSERT INTO suppliers (
    code,
    name,
    contact_name,
    email,
    phone,
    vat_number,
    notes,
    is_active,
    created_at,
    updated_at
  )
  VALUES (
    v_code,
    v_name,
    v_contact_name,
    v_email,
    v_phone,
    v_vat_number,
    v_notes,
    true,
    v_now,
    v_now
  )
  RETURNING id INTO v_supplier_id;
  RETURN jsonb_build_object(
    'supplier_id', v_supplier_id,
    'code', v_code
  );
END;
$$;

CREATE OR REPLACE FUNCTION update_supplier(
  p_supplier_id uuid,
  p_name text DEFAULT NULL,
  p_contact_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_vat_number text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier suppliers%ROWTYPE;
  v_name text;
  v_contact_name text;
  v_email text;
  v_phone text;
  v_vat_number text;
  v_notes text;
  v_now timestamptz := now();
BEGIN
  PERFORM require_role('owner', 'partner');
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier id is required.';
  END IF;
  SELECT *
  INTO v_supplier
  FROM suppliers
  WHERE id = p_supplier_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier was not found.';
  END IF;
  IF p_name IS NULL THEN
    v_name := v_supplier.name;
  ELSE
    v_name := NULLIF(btrim(p_name), '');
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'Supplier name is required.';
    END IF;
  END IF;
  IF p_contact_name IS NULL THEN
    v_contact_name := v_supplier.contact_name;
  ELSE
    v_contact_name := NULLIF(btrim(p_contact_name), '');
  END IF;
  IF p_email IS NULL THEN
    v_email := v_supplier.email;
  ELSE
    v_email := NULLIF(btrim(p_email), '');
  END IF;
  IF p_phone IS NULL THEN
    v_phone := v_supplier.phone;
  ELSE
    v_phone := NULLIF(btrim(p_phone), '');
  END IF;
  IF p_vat_number IS NULL THEN
    v_vat_number := v_supplier.vat_number;
  ELSE
    v_vat_number := NULLIF(btrim(p_vat_number), '');
  END IF;
  IF p_notes IS NULL THEN
    v_notes := v_supplier.notes;
  ELSE
    v_notes := NULLIF(btrim(p_notes), '');
  END IF;
  UPDATE suppliers
  SET
    name = v_name,
    contact_name = v_contact_name,
    email = v_email,
    phone = v_phone,
    vat_number = v_vat_number,
    notes = v_notes,
    updated_at = v_now
  WHERE id = p_supplier_id;
  RETURN jsonb_build_object(
    'supplier_id', p_supplier_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION deactivate_supplier(
  p_supplier_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier suppliers%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  PERFORM require_role('owner', 'partner');
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier id is required.';
  END IF;
  SELECT *
  INTO v_supplier
  FROM suppliers
  WHERE id = p_supplier_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier was not found.';
  END IF;
  IF v_supplier.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'supplier_id', p_supplier_id,
      'is_active', false,
      'already_inactive', true
    );
  END IF;
  UPDATE suppliers
  SET
    is_active = false,
    updated_at = v_now
  WHERE id = p_supplier_id;
  RETURN jsonb_build_object(
    'supplier_id', p_supplier_id,
    'is_active', false,
    'already_inactive', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION increment_ingredient_stock(
  p_ingredient_id uuid,
  p_quantity numeric
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM require_role('owner', 'partner');
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Stock increase quantity must be greater than zero';
  END IF;
  UPDATE ingredients
  SET current_stock = current_stock + p_quantity
  WHERE id = p_ingredient_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found: %', p_ingredient_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION start_production_session(
  p_production_plan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_plan production_plans%ROWTYPE;
  v_open_id uuid;
  v_session_id uuid;
  v_now timestamptz := now();
  v_product_count integer;
BEGIN
  PERFORM require_role('owner', 'partner');
  IF p_production_plan_id IS NULL THEN
    RAISE EXCEPTION 'Production plan id is required.';
  END IF;
  SELECT *
  INTO v_plan
  FROM production_plans
  WHERE id = p_production_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production plan was not found.';
  END IF;
  IF v_plan.status IS DISTINCT FROM 'ready_to_produce' THEN
    RAISE EXCEPTION
      'This production plan is not ready for execution. Only plans with status Ready for Production can start a session.';
  END IF;
  SELECT id
  INTO v_open_id
  FROM production_sessions
  WHERE production_plan_id = p_production_plan_id
    AND status IN ('ready', 'in_progress')
  ORDER BY started_at DESC
  LIMIT 1
  FOR UPDATE;
  IF v_open_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'session_id', v_open_id,
      'reused', true
    );
  END IF;
  SELECT count(*)::integer
  INTO v_product_count
  FROM production_plan_products
  WHERE production_plan_id = p_production_plan_id;
  IF v_product_count = 0 THEN
    RAISE EXCEPTION
      'This production plan has no products. Add products before starting production.';
  END IF;
  BEGIN
    INSERT INTO production_sessions (
      production_plan_id,
      status,
      started_at,
      operator_name,
      notes,
      updated_at
    )
    VALUES (
      p_production_plan_id,
      'in_progress',
      v_now,
      NULL,
      NULL,
      v_now
    )
    RETURNING id INTO v_session_id;
    INSERT INTO production_session_lines (
      production_session_id,
      production_plan_product_id,
      recipe_id,
      product_name,
      planned_quantity,
      actual_produced_quantity,
      yield_unit,
      sort_order,
      updated_at
    )
    SELECT
      v_session_id,
      p.id,
      p.recipe_id,
      p.recipe_name,
      p.planned_quantity,
      NULL,
      p.yield_unit,
      p.sort_order,
      v_now
    FROM production_plan_products p
    WHERE p.production_plan_id = p_production_plan_id
    ORDER BY p.sort_order ASC, p.created_at ASC;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id
      INTO v_open_id
      FROM production_sessions
      WHERE production_plan_id = p_production_plan_id
        AND status IN ('ready', 'in_progress')
      ORDER BY started_at DESC
      LIMIT 1;
      IF v_open_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'session_id', v_open_id,
          'reused', true
        );
      END IF;
      RAISE;
  END;
  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'reused', false
  );
END;
$$;

CREATE OR REPLACE FUNCTION save_production_session(
  p_session_id uuid,
  p_notes text,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_session production_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_line jsonb;
  v_line_id uuid;
  v_actual numeric;
  v_actual_raw text;
  v_raw_scale numeric;
  v_raw_scale_raw text;
  v_updated integer;
BEGIN
  PERFORM require_role('owner', 'partner');
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Production session id is required.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Production session lines are required.';
  END IF;
  SELECT *
  INTO v_session
  FROM production_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production session was not found.';
  END IF;
  IF v_session.status IN ('completed', 'cancelled')
     OR v_session.status IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION 'This production session can no longer be edited.';
  END IF;
  UPDATE production_sessions
  SET
    notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
    updated_at = v_now
  WHERE id = p_session_id
    AND status = 'in_progress';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'This production session can no longer be edited.';
  END IF;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      v_line_id := (v_line ->> 'line_id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'One or more session lines are invalid.';
    END;
    IF v_line_id IS NULL THEN
      RAISE EXCEPTION 'One or more session lines are invalid.';
    END IF;
    v_actual_raw := v_line ->> 'actual_produced_quantity';
    IF v_actual_raw IS NULL OR btrim(v_actual_raw) = '' THEN
      v_actual := NULL;
    ELSE
      BEGIN
        v_actual := v_actual_raw::numeric;
      EXCEPTION
        WHEN others THEN
          RAISE EXCEPTION 'Enter a valid produced quantity.';
      END;
      IF v_actual < 0 THEN
        RAISE EXCEPTION 'Produced quantity cannot be negative.';
      END IF;
    END IF;
    v_raw_scale_raw := v_line ->> 'raw_material_scale';
    IF v_raw_scale_raw IS NULL OR btrim(v_raw_scale_raw) = '' THEN
      v_raw_scale := NULL;
    ELSE
      BEGIN
        v_raw_scale := v_raw_scale_raw::numeric;
      EXCEPTION
        WHEN others THEN
          RAISE EXCEPTION 'Enter a valid number of recipe batches.';
      END;
      IF v_raw_scale <= 0 THEN
        RAISE EXCEPTION 'Recipe batches used must be a positive number.';
      END IF;
    END IF;
    UPDATE production_session_lines
    SET
      actual_produced_quantity = v_actual,
      raw_material_scale = v_raw_scale,
      updated_at = v_now
    WHERE id = v_line_id
      AND production_session_id = p_session_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'One or more session lines are invalid.';
    END IF;
  END LOOP;
  RETURN jsonb_build_object(
    'session_id', p_session_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION complete_production_session(
  p_session_id uuid,
  p_notes text,
  p_lines jsonb,
  p_completed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session production_sessions%ROWTYPE;
  v_now timestamptz := now();
  v_completed_by uuid;
  v_line jsonb;
  v_line_id uuid;
  v_actual numeric;
  v_raw_scale numeric;
  v_raw_scale_raw text;
  v_session_line production_session_lines%ROWTYPE;
  v_recipe recipes%ROWTYPE;
  v_scale numeric;
  v_recipe_item record;
  v_batch_plan record;
  v_consumption record;
  v_stock record;
  v_scaled_qty numeric;
  v_line_total_cost numeric;
  v_unit_cost numeric;
  v_transaction_id uuid;
  v_total_cost numeric := 0;
  v_batch_ids uuid[] := ARRAY[]::uuid[];
  v_batch_id uuid;
  v_batch_count integer := 0;
  v_line_count integer := 0;
  v_updated integer;
  v_conflict_ingredient_id uuid;
  v_conflict_ingredient_name text;
  v_conflict_units text;
BEGIN
  PERFORM require_role('owner', 'partner');
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'Production session id is required.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'Production session lines are required.';
  END IF;
  v_completed_by := COALESCE(p_completed_by, auth.uid());
  IF v_completed_by IS NULL THEN
    RAISE EXCEPTION 'Completed by user is required.';
  END IF;
  SELECT *
  INTO v_session
  FROM production_sessions
  WHERE id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production session was not found.';
  END IF;
  IF v_session.status = 'completed' THEN
    RAISE EXCEPTION 'This production session is already completed.';
  END IF;
  IF v_session.status = 'cancelled' THEN
    RAISE EXCEPTION 'This production session was cancelled.';
  END IF;
  IF v_session.status IS DISTINCT FROM 'in_progress' THEN
    RAISE EXCEPTION 'Only in-progress production sessions can be completed.';
  END IF;
  v_line_count := jsonb_array_length(p_lines);
  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'This session has no products to produce.';
  END IF;
  UPDATE production_sessions
  SET
    notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
    updated_at = v_now
  WHERE id = p_session_id;
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      v_line_id := (v_line ->> 'line_id')::uuid;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'One or more session lines are invalid.';
    END;
    IF v_line_id IS NULL THEN
      RAISE EXCEPTION 'One or more session lines are invalid.';
    END IF;
    IF v_line ->> 'actual_produced_quantity' IS NULL
       OR btrim(v_line ->> 'actual_produced_quantity') = '' THEN
      RAISE EXCEPTION
        'Enter an actual produced quantity for every product before finishing.';
    END IF;
    BEGIN
      v_actual := (v_line ->> 'actual_produced_quantity')::numeric;
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'Enter a valid produced quantity.';
    END;
    IF v_actual < 0 THEN
      RAISE EXCEPTION 'Produced quantity cannot be negative.';
    END IF;
    v_raw_scale_raw := v_line ->> 'raw_material_scale';
    IF v_raw_scale_raw IS NULL OR btrim(v_raw_scale_raw) = '' THEN
      v_raw_scale := NULL;
    ELSE
      BEGIN
        v_raw_scale := v_raw_scale_raw::numeric;
      EXCEPTION
        WHEN others THEN
          RAISE EXCEPTION 'Enter a valid number of recipe batches.';
      END;
      IF v_raw_scale <= 0 THEN
        RAISE EXCEPTION 'Recipe batches used must be a positive number.';
      END IF;
    END IF;
    UPDATE production_session_lines
    SET
      actual_produced_quantity = v_actual,
      raw_material_scale = v_raw_scale,
      updated_at = v_now
    WHERE id = v_line_id
      AND production_session_id = p_session_id;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
      RAISE EXCEPTION 'One or more session lines are invalid.';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1
    FROM production_session_lines
    WHERE production_session_id = p_session_id
      AND actual_produced_quantity IS NULL
  ) THEN
    RAISE EXCEPTION
      'Enter an actual produced quantity for every product before finishing.';
  END IF;
  IF (
    SELECT count(*)::integer
    FROM production_session_lines
    WHERE production_session_id = p_session_id
  ) <> v_line_count THEN
    RAISE EXCEPTION
      'Enter an actual produced quantity for every product before finishing.';
  END IF;
  SELECT ri.ingredient_id, i.name, string_agg(DISTINCT ri.unit, ', ' ORDER BY ri.unit)
  INTO v_conflict_ingredient_id, v_conflict_ingredient_name, v_conflict_units
  FROM production_session_lines psl
  JOIN recipe_items ri ON ri.recipe_id = psl.recipe_id
  JOIN ingredients i ON i.id = ri.ingredient_id
  WHERE psl.production_session_id = p_session_id
    AND psl.actual_produced_quantity IS NOT NULL
    AND psl.actual_produced_quantity > 0
  GROUP BY ri.ingredient_id, i.name
  HAVING COUNT(DISTINCT ri.unit) > 1
  LIMIT 1;
  IF v_conflict_ingredient_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Ingredient "%" has inconsistent units across the recipes in this production session (found: %). Fix the affected recipes before completing this session.',
      v_conflict_ingredient_name,
      v_conflict_units;
  END IF;
  DROP TABLE IF EXISTS tmp_production_consumption;
  DROP TABLE IF EXISTS tmp_production_batches;
  CREATE TEMP TABLE tmp_production_consumption (
    ingredient_id uuid PRIMARY KEY,
    quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
    total_cost numeric(14, 6) NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  CREATE TEMP TABLE tmp_production_batches (
    session_line_id uuid PRIMARY KEY,
    finished_good_id uuid NOT NULL,
    recipe_id uuid NOT NULL,
    produced_quantity numeric(12, 3) NOT NULL,
    unit_cost numeric(12, 4) NOT NULL,
    total_cost numeric(14, 6) NOT NULL
  ) ON COMMIT DROP;
  FOR v_session_line IN
    SELECT *
    FROM production_session_lines
    WHERE production_session_id = p_session_id
    ORDER BY sort_order ASC
  LOOP
    IF v_session_line.actual_produced_quantity IS NULL
       OR v_session_line.actual_produced_quantity = 0 THEN
      CONTINUE;
    END IF;
    SELECT *
    INTO v_recipe
    FROM recipes
    WHERE id = v_session_line.recipe_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION
        'Recipe for "%" was not found.',
        v_session_line.product_name;
    END IF;
    IF NOT v_recipe.is_active THEN
      RAISE EXCEPTION
        'Recipe "%" is inactive and cannot be produced.',
        v_recipe.name;
    END IF;
    IF v_recipe.yield_quantity IS NULL OR v_recipe.yield_quantity <= 0 THEN
      RAISE EXCEPTION
        'Recipe "%" has an invalid yield.',
        v_recipe.name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM recipe_items WHERE recipe_id = v_recipe.id
    ) THEN
      RAISE EXCEPTION
        'Recipe "%" has no ingredients.',
        v_recipe.name;
    END IF;
    v_scale := COALESCE(
      v_session_line.raw_material_scale,
      v_session_line.actual_produced_quantity / v_recipe.yield_quantity
    );
    v_line_total_cost := 0;
    FOR v_recipe_item IN
      SELECT
        ri.ingredient_id,
        ri.quantity AS bom_quantity,
        i.id AS ingredient_row_id,
        i.name AS ingredient_name,
        COALESCE(i.cost_per_unit, 0) AS cost_per_unit
      FROM recipe_items ri
      LEFT JOIN ingredients i ON i.id = ri.ingredient_id
      WHERE ri.recipe_id = v_recipe.id
    LOOP
      IF v_recipe_item.ingredient_row_id IS NULL THEN
        RAISE EXCEPTION
          'Recipe "%" references a missing ingredient.',
          v_recipe.name;
      END IF;
      v_scaled_qty := round(v_recipe_item.bom_quantity * v_scale, 3);
      IF v_scaled_qty <= 0 THEN
        CONTINUE;
      END IF;
      v_line_total_cost :=
        v_line_total_cost
        + (v_scaled_qty * v_recipe_item.cost_per_unit);
      INSERT INTO tmp_production_consumption AS c (
        ingredient_id,
        quantity,
        total_cost
      )
      VALUES (
        v_recipe_item.ingredient_id,
        v_scaled_qty,
        v_scaled_qty * v_recipe_item.cost_per_unit
      )
      ON CONFLICT (ingredient_id) DO UPDATE
      SET
        quantity = round(c.quantity + EXCLUDED.quantity, 3),
        total_cost = c.total_cost + EXCLUDED.total_cost;
    END LOOP;
    v_unit_cost := round(
      v_line_total_cost / v_session_line.actual_produced_quantity,
      4
    );
    INSERT INTO tmp_production_batches (
      session_line_id,
      finished_good_id,
      recipe_id,
      produced_quantity,
      unit_cost,
      total_cost
    )
    VALUES (
      v_session_line.id,
      v_session_line.recipe_id,
      v_session_line.recipe_id,
      v_session_line.actual_produced_quantity,
      v_unit_cost,
      v_line_total_cost
    );
    v_total_cost := v_total_cost + v_line_total_cost;
  END LOOP;
  FOR v_stock IN
    SELECT
      c.ingredient_id,
      c.quantity AS required_quantity,
      i.name AS ingredient_name,
      i.current_stock
    FROM tmp_production_consumption c
    JOIN ingredients i ON i.id = c.ingredient_id
    ORDER BY c.ingredient_id
    FOR UPDATE OF i
  LOOP
    IF v_stock.current_stock < v_stock.required_quantity THEN
      RAISE EXCEPTION
        'Insufficient stock for "%". Required %, available %.',
        v_stock.ingredient_name,
        round(v_stock.required_quantity, 3),
        round(v_stock.current_stock, 3);
    END IF;
  END LOOP;
  INSERT INTO transactions (
    type,
    status,
    reference_type,
    reference_id,
    amount,
    currency,
    description,
    occurred_at,
    posted_at,
    created_at,
    updated_at
  )
  VALUES (
    'production',
    'posted',
    'production_session',
    p_session_id,
    round(v_total_cost, 2),
    'EUR',
    format('Production session #%s completed', v_session.session_number),
    v_now,
    v_now,
    v_now,
    v_now
  )
  RETURNING id INTO v_transaction_id;
  FOR v_consumption IN
    SELECT ingredient_id, quantity, total_cost
    FROM tmp_production_consumption
    ORDER BY ingredient_id
  LOOP
    PERFORM decrement_ingredient_stock(
      v_consumption.ingredient_id,
      v_consumption.quantity
    );
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
      v_consumption.ingredient_id,
      NULL,
      'production_out',
      v_consumption.quantity,
      CASE
        WHEN v_consumption.quantity > 0 THEN
          round(v_consumption.total_cost / v_consumption.quantity, 4)
        ELSE 0
      END,
      v_transaction_id,
      'production_session',
      p_session_id,
      v_now,
      v_now
    );
  END LOOP;
  FOR v_batch_plan IN
    SELECT
      b.session_line_id,
      b.finished_good_id,
      b.recipe_id,
      b.produced_quantity,
      b.unit_cost
    FROM tmp_production_batches b
    JOIN production_session_lines sl ON sl.id = b.session_line_id
    WHERE sl.production_session_id = p_session_id
    ORDER BY sl.sort_order ASC
  LOOP
    INSERT INTO production_batches (
      production_session_id,
      production_session_line_id,
      finished_good_id,
      recipe_id,
      produced_quantity,
      unit_cost,
      produced_at,
      created_at
    )
    VALUES (
      p_session_id,
      v_batch_plan.session_line_id,
      v_batch_plan.finished_good_id,
      v_batch_plan.recipe_id,
      v_batch_plan.produced_quantity,
      v_batch_plan.unit_cost,
      v_now,
      v_now
    )
    RETURNING id INTO v_batch_id;
    v_batch_ids := array_append(v_batch_ids, v_batch_id);
    v_batch_count := v_batch_count + 1;
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
      NULL,
      v_batch_plan.finished_good_id,
      'production_in',
      v_batch_plan.produced_quantity,
      v_batch_plan.unit_cost,
      v_transaction_id,
      'production_session',
      p_session_id,
      v_now,
      v_now
    );
  END LOOP;
  UPDATE production_sessions
  SET
    status = 'completed',
    completed_at = v_now,
    completed_by = v_completed_by,
    notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
    updated_at = v_now
  WHERE id = p_session_id
    AND status = 'in_progress';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated = 0 THEN
    RAISE EXCEPTION 'This production session is already completed.';
  END IF;
  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'transaction_id', v_transaction_id,
    'batch_count', v_batch_count,
    'batch_ids', to_jsonb(v_batch_ids),
    'total_cost', round(v_total_cost, 2),
    'completed_at', v_now,
    'completed_by', v_completed_by
  );
END;
$$;

CREATE OR REPLACE FUNCTION confirm_production_plan(
  p_plan_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan production_plans%ROWTYPE;
  v_product_count integer;
  v_sufficient boolean;
  v_conflict_ingredient_id uuid;
  v_conflict_ingredient_name text;
  v_conflict_units text;
BEGIN
  PERFORM require_role('owner', 'partner');
  SELECT * INTO v_plan
  FROM production_plans
  WHERE id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production plan % was not found.', p_plan_id;
  END IF;
  IF v_plan.status <> 'draft' THEN
    RAISE EXCEPTION 'Only a draft production plan can be confirmed.';
  END IF;
  SELECT COUNT(*) INTO v_product_count
  FROM production_plan_products
  WHERE production_plan_id = p_plan_id;
  IF v_product_count = 0 THEN
    RAISE EXCEPTION 'Add at least one product before confirming the plan.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM production_plan_products ppp
    WHERE ppp.production_plan_id = p_plan_id
      AND NOT EXISTS (
        SELECT 1 FROM recipe_items ri WHERE ri.recipe_id = ppp.recipe_id
      )
  ) THEN
    RAISE EXCEPTION 'One or more recipes on this plan have no ingredients.';
  END IF;
  SELECT ri.ingredient_id, i.name, string_agg(DISTINCT ri.unit, ', ' ORDER BY ri.unit)
  INTO v_conflict_ingredient_id, v_conflict_ingredient_name, v_conflict_units
  FROM production_plan_products ppp
  JOIN recipe_items ri ON ri.recipe_id = ppp.recipe_id
  JOIN ingredients i ON i.id = ri.ingredient_id
  WHERE ppp.production_plan_id = p_plan_id
  GROUP BY ri.ingredient_id, i.name
  HAVING COUNT(DISTINCT ri.unit) > 1
  LIMIT 1;
  IF v_conflict_ingredient_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Ingredient "%" has inconsistent units across the recipes on this plan (found: %). Fix the affected recipes before confirming this plan.',
      v_conflict_ingredient_name,
      v_conflict_units;
  END IF;
  INSERT INTO production_plan_ingredients (
    production_plan_id,
    ingredient_id,
    ingredient_name,
    unit,
    required_quantity,
    inventory_quantity_at_planning,
    missing_quantity
  )
  SELECT
    p_plan_id,
    req.ingredient_id,
    i.name,
    req.unit,
    req.required_quantity,
    i.current_stock,
    GREATEST(req.required_quantity - i.current_stock, 0)
  FROM (
    SELECT
      ri.ingredient_id,
      round(
        SUM(ri.quantity * ppp.planned_quantity / ppp.yield_quantity),
        3
      ) AS required_quantity,
      MIN(ri.unit) AS unit
    FROM production_plan_products ppp
    JOIN recipe_items ri ON ri.recipe_id = ppp.recipe_id
    WHERE ppp.production_plan_id = p_plan_id
    GROUP BY ri.ingredient_id
  ) req
  JOIN ingredients i ON i.id = req.ingredient_id;
  UPDATE production_plans
  SET status = 'planned', updated_at = now()
  WHERE id = p_plan_id;
  SELECT NOT EXISTS (
    SELECT 1
    FROM production_plan_ingredients
    WHERE production_plan_id = p_plan_id
      AND missing_quantity > 0
  ) INTO v_sufficient;
  IF v_sufficient THEN
    UPDATE production_plans
    SET status = 'ready_to_produce', updated_at = now()
    WHERE id = p_plan_id;
  END IF;
  SELECT * INTO v_plan FROM production_plans WHERE id = p_plan_id;
  RETURN to_jsonb(v_plan);
END;
$$;

CREATE OR REPLACE FUNCTION check_production_plan_readiness(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_sufficient boolean;
  v_plan production_plans%ROWTYPE;
BEGIN
  PERFORM require_role('owner', 'partner');
  SELECT status INTO v_status
  FROM production_plans
  WHERE id = p_plan_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production plan % was not found.', p_plan_id;
  END IF;
  IF v_status IN ('planned', 'waiting_for_purchases') THEN
    SELECT NOT EXISTS (
      SELECT 1
      FROM production_plan_ingredients ppi
      JOIN ingredients i ON i.id = ppi.ingredient_id
      WHERE ppi.production_plan_id = p_plan_id
        AND i.current_stock + 1e-9 < ppi.required_quantity
    )
    INTO v_sufficient;
    IF v_sufficient THEN
      UPDATE production_plans
      SET status = 'ready_to_produce', updated_at = now()
      WHERE id = p_plan_id;
    END IF;
  END IF;
  SELECT * INTO v_plan FROM production_plans WHERE id = p_plan_id;
  RETURN to_jsonb(v_plan);
END;
$$;
