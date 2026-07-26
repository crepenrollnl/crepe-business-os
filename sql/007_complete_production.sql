-- Complete Production (PRD-001 / DEV-015)
-- Run in Supabase SQL editor after 006_create_production_sessions.sql.
--
-- Atomic Production Session completion (single DB transaction):
--   validate IN_PROGRESS → consume raw materials via inventory transactions
--   (transactions + stock_movements) → production batches (Finished Goods)
--   → mark session COMPLETED with completed_at / completed_by
--
-- Inventory balances are never edited outside stock mutation primitives that
-- run together with immutable stock_movements in this same transaction.
-- Finished Goods availability is registered by inserting immutable
-- production_batches. There is no finished_goods stock table.
-- remaining_quantity is NEVER stored on batches.
-- Only Actual Produced Quantity is used (never Planned Quantity).

-- ---------------------------------------------------------------------------
-- Session completion audit columns
-- ---------------------------------------------------------------------------

ALTER TABLE production_sessions
  ADD COLUMN IF NOT EXISTS completed_by uuid;

-- ---------------------------------------------------------------------------
-- Transactions (operational event ledger = Inventory Transactions)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL
    CHECK (
      type IN (
        'purchase',
        'sale',
        'production',
        'waste',
        'transfer',
        'inventory_adjustment',
        'salary',
        'tax',
        'expense',
        'refund'
      )
    ),
  status text NOT NULL DEFAULT 'posted'
    CHECK (status IN ('draft', 'posted', 'voided')),
  reference_type text NOT NULL
    CHECK (
      reference_type IN (
        'purchase',
        'sale',
        'production_order',
        'production_session',
        'stock_movement',
        'payment',
        'manual',
        'event'
      )
    ),
  reference_id uuid,
  amount numeric(12, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'EUR',
  description text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_type_idx ON transactions (type);
CREATE INDEX IF NOT EXISTS transactions_reference_idx
  ON transactions (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS transactions_occurred_at_idx
  ON transactions (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Stock movements (immutable quantity ledger)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id uuid REFERENCES ingredients (id),
  product_id uuid,
  movement_type text NOT NULL
    CHECK (
      movement_type IN (
        'purchase_in',
        'sale_out',
        'production_in',
        'production_out',
        'waste_out',
        'transfer_in',
        'transfer_out',
        'adjustment'
      )
    ),
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(12, 4),
  transaction_id uuid REFERENCES transactions (id),
  reference_type text NOT NULL
    CHECK (
      reference_type IN (
        'purchase',
        'sale',
        'production_order',
        'production_session',
        'stock_movement',
        'payment',
        'manual',
        'event'
      )
    ),
  reference_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_target_chk CHECK (
    ingredient_id IS NOT NULL OR product_id IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS stock_movements_ingredient_id_idx
  ON stock_movements (ingredient_id);
CREATE INDEX IF NOT EXISTS stock_movements_product_id_idx
  ON stock_movements (product_id);
CREATE INDEX IF NOT EXISTS stock_movements_transaction_id_idx
  ON stock_movements (transaction_id);
CREATE INDEX IF NOT EXISTS stock_movements_reference_idx
  ON stock_movements (reference_type, reference_id);
CREATE INDEX IF NOT EXISTS stock_movements_occurred_at_idx
  ON stock_movements (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Production batches (immutable finished-goods production events)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS production_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  production_session_id uuid NOT NULL REFERENCES production_sessions (id),
  production_session_line_id uuid NOT NULL REFERENCES production_session_lines (id),
  -- Until Products master exists, finished_good_id = recipe_id (planning convention).
  finished_good_id uuid NOT NULL,
  recipe_id uuid NOT NULL REFERENCES recipes (id),
  produced_quantity numeric(12, 3) NOT NULL CHECK (produced_quantity > 0),
  unit_cost numeric(12, 4) NOT NULL CHECK (unit_cost >= 0),
  produced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_batches_one_per_line UNIQUE (production_session_line_id)
);

CREATE INDEX IF NOT EXISTS production_batches_session_id_idx
  ON production_batches (production_session_id);
CREATE INDEX IF NOT EXISTS production_batches_finished_good_id_idx
  ON production_batches (finished_good_id);
CREATE INDEX IF NOT EXISTS production_batches_recipe_id_idx
  ON production_batches (recipe_id);
CREATE INDEX IF NOT EXISTS production_batches_produced_at_idx
  ON production_batches (produced_at DESC);

-- ---------------------------------------------------------------------------
-- Stock decrease with sufficiency check (INTERNAL ONLY)
--
-- Called exclusively via PERFORM from complete_production_session.
-- Must NOT be executable by authenticated/anon clients (DEV-017).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION decrement_ingredient_stock(
  p_ingredient_id uuid,
  p_quantity numeric
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_name text;
  v_stock numeric;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Stock decrease quantity must be greater than zero';
  END IF;

  SELECT name, current_stock
  INTO v_name, v_stock
  FROM ingredients
  WHERE id = p_ingredient_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found: %', p_ingredient_id;
  END IF;

  IF v_stock < p_quantity THEN
    RAISE EXCEPTION
      'Insufficient stock for "%". Required %, available %.',
      COALESCE(v_name, 'ingredient'),
      round(p_quantity, 3),
      round(v_stock, 3);
  END IF;

  UPDATE ingredients
  SET current_stock = current_stock - p_quantity
  WHERE id = p_ingredient_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic complete production session
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS complete_production_session(uuid, text, jsonb);
DROP FUNCTION IF EXISTS complete_production_session(uuid, text, jsonb, uuid);

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
BEGIN
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

  -- BR-001 / BR-002: only IN_PROGRESS may complete; completed is immutable.
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

    UPDATE production_session_lines
    SET
      actual_produced_quantity = v_actual,
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

    v_scale :=
      v_session_line.actual_produced_quantity / v_recipe.yield_quantity;
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

  -- Lock and validate inventory before mutation.
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

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_batches ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'transactions'
      AND policyname = 'transactions_authenticated_all'
  ) THEN
    CREATE POLICY transactions_authenticated_all
      ON transactions
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'stock_movements'
      AND policyname = 'stock_movements_authenticated_all'
  ) THEN
    CREATE POLICY stock_movements_authenticated_all
      ON stock_movements
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'production_batches'
      AND policyname = 'production_batches_authenticated_all'
  ) THEN
    CREATE POLICY production_batches_authenticated_all
      ON production_batches
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Public entry point for Production Completion (authenticated clients).
GRANT EXECUTE ON FUNCTION complete_production_session(uuid, text, jsonb, uuid) TO authenticated;

-- DEV-017: decrement_ingredient_stock is an internal implementation detail of
-- complete_production_session (SECURITY DEFINER). Revoke direct client access.
REVOKE ALL ON FUNCTION decrement_ingredient_stock(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION decrement_ingredient_stock(uuid, numeric) FROM anon;
REVOKE ALL ON FUNCTION decrement_ingredient_stock(uuid, numeric) FROM authenticated;

-- ---------------------------------------------------------------------------
-- Immutability: completed/cancelled sessions cannot be edited (BR-002)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_open_production_session_line_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status
  INTO v_status
  FROM production_sessions
  WHERE id = NEW.production_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production session was not found.';
  END IF;

  IF v_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'This production session can no longer be edited.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS production_session_lines_open_only ON production_session_lines;

CREATE TRIGGER production_session_lines_open_only
  BEFORE INSERT OR UPDATE ON production_session_lines
  FOR EACH ROW
  EXECUTE FUNCTION enforce_open_production_session_line_mutation();
