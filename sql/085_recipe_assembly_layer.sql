-- Recipe Assembly Layer (Critical Finding #4, Step 1)
-- Run in Supabase SQL editor after sql/084_fixed_assets_depreciation.sql.
--
-- Business reality: everything on the menu is made to order (payment
-- happens before cooking). Only sub-components (dough, fillings, sauces,
-- chicken, salmon) are produced ahead of time via existing Production.
-- The sold dish (e.g. Chicken Crepe) is assembled from components at the
-- moment of sale -- including pan-frying, which is not tracked as its own
-- step and simply "dissolves" into the sale.
--
-- Until today, confirm_sale assumed every product_id was itself a
-- pre-produced Finished Good sitting in production_batches -- see
-- sql/014 / sql/079. That is only true for a directly-sold component; it
-- is false for the dish itself, which has never been produced ahead of
-- time and therefore can never be sold under the old model.
--
-- This migration:
--   1. Adds recipes.recipe_role ('component' | 'assembly') so a recipe can
--      say which of the two it is.
--   2. Adds recipe_components: the assembly's bill-of-components (how much
--      of which component recipe one portion of the assembly needs).
--   3. Widens allocate_finished_goods_fifo's duplicate-source guard from
--      (source_type, source_id) to (source_type, source_id, product_id) --
--      required so one sale line (one source_id) can allocate several
--      different components, one call per component. See the file-header
--      comment on that function below for the full reasoning.
--   4. Replaces confirm_sale so an assembly product_id is fulfilled by
--      FIFO-allocating every one of its components instead of expecting a
--      pre-produced batch of the dish itself. A component product_id keeps
--      today's exact behaviour (direct FIFO against its own batches) --
--      not the expected path once recipes are re-tagged, kept only as
--      compatibility for selling a component directly.
--
-- Does NOT touch: UI, recipe-items BOM-cost logic, Accounting posting code
-- (postJournalForProductionCompleted / confirmSaleAndPostJournals /
-- cogs-recognized-posting-rule) -- confirm_sale's return shape is
-- unchanged ({ sale_id, total_cogs }), so the existing "one total_cogs
-- number per sale" contract those consume is unaffected.

-- ---------------------------------------------------------------------------
-- 1. recipes.recipe_role
-- ---------------------------------------------------------------------------

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS recipe_role text NOT NULL DEFAULT 'assembly'
    CHECK (recipe_role IN ('component', 'assembly'));

-- Explicit, auditable statement of intent for the one pre-existing row.
-- Redundant with the column DEFAULT above (every existing row already
-- becomes 'assembly') -- kept as a documented no-op-if-absent safety net,
-- not as the actual mechanism. If no recipe is named exactly "Chicken
-- Crepe" this UPDATE simply affects zero rows.
UPDATE recipes SET recipe_role = 'assembly' WHERE name = 'Chicken Crepe';

-- ---------------------------------------------------------------------------
-- 2. recipe_components (assembly bill-of-components)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recipe_components (
  assembly_recipe_id uuid NOT NULL REFERENCES recipes (id) ON DELETE CASCADE,
  component_recipe_id uuid NOT NULL REFERENCES recipes (id),
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assembly_recipe_id, component_recipe_id),
  CONSTRAINT recipe_components_not_self_chk
    CHECK (assembly_recipe_id <> component_recipe_id)
);

CREATE INDEX IF NOT EXISTS recipe_components_assembly_id_idx
  ON recipe_components (assembly_recipe_id);
CREATE INDEX IF NOT EXISTS recipe_components_component_id_idx
  ON recipe_components (component_recipe_id);

-- A plain FK cannot express "must be a component-role recipe" / "must be
-- an assembly-role recipe" -- enforce with a trigger instead (same reason
-- a trigger, not a FK, guards recipe_components' role pairing).
CREATE OR REPLACE FUNCTION enforce_recipe_component_roles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_assembly_role text;
  v_component_role text;
BEGIN
  SELECT recipe_role INTO v_assembly_role
  FROM recipes WHERE id = NEW.assembly_recipe_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assembly recipe was not found.';
  END IF;

  IF v_assembly_role <> 'assembly' THEN
    RAISE EXCEPTION
      'Recipe % cannot be used as an assembly recipe: recipe_role is "%", expected "assembly".',
      NEW.assembly_recipe_id, v_assembly_role;
  END IF;

  SELECT recipe_role INTO v_component_role
  FROM recipes WHERE id = NEW.component_recipe_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Component recipe was not found.';
  END IF;

  IF v_component_role <> 'component' THEN
    RAISE EXCEPTION
      'Recipe % cannot be used as a component: recipe_role is "%", expected "component".',
      NEW.component_recipe_id, v_component_role;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recipe_components_enforce_roles ON recipe_components;

CREATE TRIGGER recipe_components_enforce_roles
  BEFORE INSERT OR UPDATE ON recipe_components
  FOR EACH ROW
  EXECUTE FUNCTION enforce_recipe_component_roles();

-- ---------------------------------------------------------------------------
-- RLS + explicit REVOKE (lesson from sql/076's first failed rollout: anon
-- holds its own direct grant on this project independent of PUBLIC
-- membership -- both must be revoked explicitly, in the same migration).
-- ---------------------------------------------------------------------------

ALTER TABLE recipe_components ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'recipe_components'
      AND policyname = 'recipe_components_authenticated_all'
  ) THEN
    CREATE POLICY recipe_components_authenticated_all
      ON recipe_components
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE recipe_components FROM PUBLIC;
REVOKE ALL ON TABLE recipe_components FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE recipe_components TO authenticated;

REVOKE ALL ON FUNCTION enforce_recipe_component_roles() FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_recipe_component_roles() FROM anon;

-- ---------------------------------------------------------------------------
-- 3. allocate_finished_goods_fifo -- widen the duplicate-source guard
--
-- The original guard (sql/011) rejected a second call for the same
-- (source_type, source_id) unconditionally:
--
--   IF EXISTS (SELECT 1 FROM finished_goods_batch_consumptions
--              WHERE source_type = p_source_type AND source_id = p_source_id)
--
-- That assumed one call == one product == one source document line, true
-- for every caller so far (confirm_sale calling once per sale line against
-- that line's own product). An assembly sale line breaks the assumption:
-- it must call this function once per component, all sharing the same
-- source_id (the sale line's id), each for a different component
-- product_id. The unqualified guard would reject the second component
-- outright.
--
-- Fix: qualify the guard by product_id too. This still blocks a genuine
-- duplicate allocation of the SAME product against the SAME source line
-- (the property the guard exists for); it only stops blocking a second,
-- different product under the same source line, which is exactly what
-- assembly requires. source_id keeps meaning exactly what it always has
-- (literally sale_lines.id) -- finished-goods-read-service.ts already
-- tolerates multiple consumption rows per source_id (multi-batch FIFO
-- already produces several rows per call today) and needs no change.
--
-- This function has exactly one caller in the whole codebase today
-- (confirm_sale) -- checked by grep across src/ and sql/ -- so widening
-- this guard has no other blast radius.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION allocate_finished_goods_fifo(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_source_type text,
  p_source_id uuid,
  p_notes text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created_by uuid;
  v_remaining_to_allocate numeric;
  v_batch record;
  v_out_sum numeric;
  v_in_sum numeric;
  v_batch_remaining numeric;
  v_take numeric;
  v_line_total numeric;
  v_total_cost numeric := 0;
  v_allocated_quantity numeric := 0;
  v_consumption_id uuid;
  v_allocations jsonb := '[]'::jsonb;
  v_notes text;
BEGIN
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Product id is required.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Allocation quantity must be greater than zero.';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'Allocation reason is required.';
  END IF;

  IF p_reason NOT IN (
    'sale',
    'internal_use',
    'waste',
    'spoilage',
    'stock_count',
    'manual_adjustment',
    'recipe_consumption'
  ) THEN
    RAISE EXCEPTION
      'Invalid allocation reason. return_restock is not allowed on FIFO outflow allocation.';
  END IF;

  IF p_source_type IS NULL OR btrim(p_source_type) = '' THEN
    RAISE EXCEPTION 'Source type is required.';
  END IF;

  IF p_source_type NOT IN (
    'sale_line',
    'pos_line',
    'order_line',
    'waste_ticket',
    'stock_count_line',
    'adjustment',
    'production_session_line'
  ) THEN
    RAISE EXCEPTION 'Invalid source type.';
  END IF;

  IF p_source_id IS NULL THEN
    RAISE EXCEPTION 'Source id is required.';
  END IF;

  -- Until Products master exists, finished goods are represented by recipes
  -- (production_batches.finished_good_id = recipe_id).
  IF NOT EXISTS (
    SELECT 1
    FROM recipes
    WHERE id = p_product_id
  ) THEN
    RAISE EXCEPTION 'Product was not found.';
  END IF;

  v_created_by := COALESCE(p_created_by, auth.uid());
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_remaining_to_allocate := p_quantity;

  -- Reject duplicate posting for the same (source document line, product).
  -- Widened from (source_type, source_id) alone -- see file-header comment
  -- above this function for why. finished_goods_batch_consumptions has no
  -- product_id column of its own -- the product is derived by joining
  -- through production_batches.finished_good_id, the same way every other
  -- reader of this ledger identifies which product a row belongs to.
  IF EXISTS (
    SELECT 1
    FROM finished_goods_batch_consumptions c
    JOIN production_batches pb ON pb.id = c.production_batch_id
    WHERE c.source_type = p_source_type
      AND c.source_id = p_source_id
      AND pb.finished_good_id = p_product_id
  ) THEN
    RAISE EXCEPTION 'This source has already been allocated.';
  END IF;

  -- Lock all batches for this finished good (FIFO order) so concurrent
  -- allocations cannot oversell. Remaining is calculated, never stored.
  FOR v_batch IN
    SELECT
      pb.id,
      pb.produced_quantity,
      pb.unit_cost,
      pb.produced_at
    FROM production_batches pb
    WHERE pb.finished_good_id = p_product_id
    ORDER BY pb.produced_at ASC, pb.id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining_to_allocate <= 0;

    SELECT
      COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'out'), 0),
      COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'in'), 0)
    INTO v_out_sum, v_in_sum
    FROM finished_goods_batch_consumptions c
    WHERE c.production_batch_id = v_batch.id;

    v_batch_remaining := v_batch.produced_quantity - v_out_sum + v_in_sum;

    -- Invariant: remaining must never be negative before allocation.
    IF v_batch_remaining < 0 THEN
      RAISE EXCEPTION
        'Finished goods ledger integrity error: batch remaining is negative.';
    END IF;

    IF v_batch_remaining <= 0 THEN
      CONTINUE;
    END IF;

    v_take := LEAST(v_batch_remaining, v_remaining_to_allocate);
    v_line_total := v_take * v_batch.unit_cost;

    INSERT INTO finished_goods_batch_consumptions (
      production_batch_id,
      quantity,
      unit_cost,
      total_cost,
      direction,
      reason,
      source_type,
      source_id,
      allocation_mode,
      notes,
      created_by
    )
    VALUES (
      v_batch.id,
      v_take,
      v_batch.unit_cost,
      v_line_total,
      'out',
      p_reason,
      p_source_type,
      p_source_id,
      'fifo',
      v_notes,
      v_created_by
    )
    RETURNING id INTO v_consumption_id;

    -- Post-insert invariant: Σ(out) − Σ(in) <= produced
    SELECT
      COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'out'), 0),
      COALESCE(SUM(c.quantity) FILTER (WHERE c.direction = 'in'), 0)
    INTO v_out_sum, v_in_sum
    FROM finished_goods_batch_consumptions c
    WHERE c.production_batch_id = v_batch.id;

    IF (v_out_sum - v_in_sum) > v_batch.produced_quantity THEN
      RAISE EXCEPTION
        'Finished goods allocation would make batch remaining negative.';
    END IF;

    v_allocations := v_allocations || jsonb_build_array(
      jsonb_build_object(
        'consumption_id', v_consumption_id,
        'production_batch_id', v_batch.id,
        'quantity', v_take,
        'unit_cost', v_batch.unit_cost,
        'total_cost', v_line_total,
        'produced_at', v_batch.produced_at
      )
    );

    v_remaining_to_allocate := v_remaining_to_allocate - v_take;
    v_allocated_quantity := v_allocated_quantity + v_take;
    v_total_cost := v_total_cost + v_line_total;
  END LOOP;

  IF v_remaining_to_allocate > 0 THEN
    RAISE EXCEPTION 'Insufficient finished goods stock for this product.';
  END IF;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'requested_quantity', p_quantity,
    'allocated_quantity', v_allocated_quantity,
    'total_cost', v_total_cost,
    'reason', p_reason,
    'source_type', p_source_type,
    'source_id', p_source_id,
    'allocations', v_allocations
  );
END;
$$;

COMMENT ON FUNCTION allocate_finished_goods_fifo(
  uuid, numeric, text, text, uuid, text, uuid
) IS
  'FIFO allocate finished goods and append immutable batch consumption ledger rows. Remaining is calculated only. Duplicate-source guard is qualified by product_id so one source line can allocate several different products (assembly components).';

REVOKE ALL ON FUNCTION allocate_finished_goods_fifo(
  uuid, numeric, text, text, uuid, text, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION allocate_finished_goods_fifo(
  uuid, numeric, text, text, uuid, text, uuid
) FROM anon;
GRANT EXECUTE ON FUNCTION allocate_finished_goods_fifo(
  uuid, numeric, text, text, uuid, text, uuid
) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. confirm_sale -- assembly-aware line fulfillment
--
-- Replaces sql/079's version in full (CREATE OR REPLACE), carrying its
-- auto-open-shift behaviour (finding 1.13) forward unchanged. The only
-- change is how each line is fulfilled:
--   - recipe_role = 'component': unchanged -- direct FIFO against the
--     product's own production_batches, exactly as today. Not the
--     expected path once real recipes are tagged 'component'/'assembly';
--     kept only as compatibility for selling a component directly.
--   - recipe_role = 'assembly': NEW -- walk recipe_components for this
--     product, and FIFO-allocate each component's own production_batches
--     for (bom quantity × sale line quantity). If any component can't be
--     fully allocated, the whole sale is rejected (RAISE EXCEPTION
--     propagates and aborts the transaction) and the error names the
--     specific missing component, not a generic message.
--
-- Return shape is unchanged: { sale_id, total_cogs }. Accounting's
-- cogs_recognized posting (sale-accounting-service.ts) already consumes
-- exactly that one total_cogs number per sale regardless of how many
-- lines or components contributed to it -- not touched by this migration.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION confirm_sale(
  p_sale_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_line sale_lines%ROWTYPE;
  v_line_count integer := 0;
  v_allocation jsonb;
  v_total_cogs numeric := 0;
  v_now timestamptz := now();
  v_shift shifts%ROWTYPE;
  v_recipe_role text;
  v_recipe_name text;
  v_component record;
  v_required_qty numeric;
  v_has_components boolean;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale id is required.';
  END IF;

  -- 1. Lock the Sale FOR UPDATE.
  SELECT *
  INTO v_sale
  FROM sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale was not found.';
  END IF;

  -- 2. Validate status == draft.
  IF v_sale.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft sales can be confirmed.';
  END IF;

  -- 2a. Ensure a shift is open so this sale's confirmed_at falls inside a
  -- real shift window (finding 1.13, sql/079). Lock any existing open
  -- shift first; only insert a new one if none is found.
  SELECT *
  INTO v_shift
  FROM shifts
  WHERE status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO shifts (status, opened_at, closed_at, opened_by)
      VALUES ('open', v_now, NULL, auth.uid())
      RETURNING * INTO v_shift;
    EXCEPTION WHEN unique_violation THEN
      -- Lost the race: a concurrent confirm_sale (or a manual
      -- openShift() click) inserted the open shift first. The row now
      -- exists, so lock and read it instead of failing this confirm.
      SELECT *
      INTO v_shift
      FROM shifts
      WHERE status = 'open'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to open or find an active shift for this sale.';
      END IF;
    END;
  END IF;

  -- 3 / 4 / 5. Lock lines, require at least one, fulfill each line
  --    according to its recipe_role, and sum COGS from allocation results.
  FOR v_line IN
    SELECT *
    FROM sale_lines
    WHERE sale_id = p_sale_id
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  LOOP
    SELECT recipe_role, name
    INTO v_recipe_role, v_recipe_name
    FROM recipes
    WHERE id = v_line.product_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product was not found.';
    END IF;

    IF v_recipe_role = 'component' THEN
      -- Unchanged: direct FIFO against this product's own
      -- production_batches. Not the expected path today (everything on
      -- the menu is an assembly) -- kept only as compatibility for
      -- selling a component directly.
      v_allocation := allocate_finished_goods_fifo(
        v_line.product_id,
        v_line.quantity,
        'sale',
        'sale_line',
        v_line.id
      );

      v_total_cogs := v_total_cogs
        + COALESCE((v_allocation ->> 'total_cost')::numeric, 0);

    ELSIF v_recipe_role = 'assembly' THEN
      v_has_components := false;

      FOR v_component IN
        SELECT
          rc.component_recipe_id,
          rc.quantity AS bom_quantity,
          r.name AS component_name
        FROM recipe_components rc
        JOIN recipes r ON r.id = rc.component_recipe_id
        WHERE rc.assembly_recipe_id = v_line.product_id
        ORDER BY rc.component_recipe_id
      LOOP
        v_has_components := true;
        v_required_qty := round(v_component.bom_quantity * v_line.quantity, 3);

        BEGIN
          v_allocation := allocate_finished_goods_fifo(
            v_component.component_recipe_id,
            v_required_qty,
            'sale',
            'sale_line',
            v_line.id
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION
            'Failed to allocate component "%" while assembling "%": %',
            v_component.component_name,
            v_recipe_name,
            SQLERRM;
        END;

        v_total_cogs := v_total_cogs
          + COALESCE((v_allocation ->> 'total_cost')::numeric, 0);
      END LOOP;

      IF NOT v_has_components THEN
        RAISE EXCEPTION
          'Recipe "%" has no components defined and cannot be assembled.',
          v_recipe_name;
      END IF;

    ELSE
      RAISE EXCEPTION
        'Recipe "%" has an unrecognized recipe_role.',
        v_recipe_name;
    END IF;

    v_line_count := v_line_count + 1;
  END LOOP;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'Sale has no lines to confirm.';
  END IF;

  -- 6 / 7. Mark Sale confirmed and store confirmed_at.
  UPDATE sales
  SET
    status = 'confirmed',
    confirmed_at = v_now,
    updated_at = v_now
  WHERE id = p_sale_id;

  -- 8. Return sale_id + total_cogs (COGS snapshotted in ledger outs).
  RETURN jsonb_build_object(
    'sale_id', p_sale_id,
    'total_cogs', v_total_cogs
  );
END;
$$;

COMMENT ON FUNCTION confirm_sale(uuid) IS
  'Confirm a draft sale: ensure a shift is open (auto-opening one if none is), fulfill each line per its product recipe_role (component: direct FIFO; assembly: FIFO-allocate every recipe_components entry), then mark confirmed. COGS comes from ledger allocation totals only.';

-- anon holds its own direct grant on this project independent of PUBLIC
-- membership (see sql/074) -- both must be revoked explicitly (lesson from
-- the first failed rollout attempt of sql/076).
REVOKE ALL ON FUNCTION confirm_sale(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_sale(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION confirm_sale(uuid) TO authenticated;
