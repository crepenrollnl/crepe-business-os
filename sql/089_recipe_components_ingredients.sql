-- Recipe Components -- direct raw-ingredient links (Critical Finding #4, follow-up)
-- Run in Supabase SQL editor after sql/088_fix_finished_goods_total_cost_check.sql.
--
-- Problem: recipe_components (sql/085) can only point an Assembly at another
-- Component recipe. A raw, no-cook add-in (sliced cucumber, lettuce) that
-- never needs its own production cycle had no way in -- the only workaround
-- was faking a Component recipe and running it through a real Production
-- Session just to get a production_batch to FIFO-allocate against. See
-- Plan_Deystviy_V1.txt item 10 (12.08.2026) for the full investigation that
-- led here.
--
-- This migration adds an alternative target on the SAME recipe_components
-- row: ingredient_id, mutually exclusive with component_recipe_id. A row
-- now points at exactly one of the two -- a Component recipe (existing
-- behaviour, FIFO-allocated from production_batches) or a raw ingredient
-- (new, decremented directly from ingredients.current_stock, costed from
-- ingredients.cost_per_unit -- the same static field complete_production_session
-- already uses, nothing new invented).
--
-- Does NOT touch: UI (recipe-editor-modal.tsx), production-service.ts,
-- allocate_finished_goods_fifo. Existing data is not migrated -- no
-- ingredient_id rows exist yet (confirmed by the business owner before this
-- migration was written).

-- ---------------------------------------------------------------------------
-- 1. recipe_components -- surrogate PK, nullable component_recipe_id,
--    new ingredient_id, "exactly one target" CHECK, partial unique indexes
-- ---------------------------------------------------------------------------

ALTER TABLE recipe_components
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

UPDATE recipe_components SET id = gen_random_uuid() WHERE id IS NULL;

ALTER TABLE recipe_components
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE recipe_components
  DROP CONSTRAINT IF EXISTS recipe_components_pkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recipe_components_pkey'
      AND conrelid = 'recipe_components'::regclass
  ) THEN
    ALTER TABLE recipe_components
      ADD CONSTRAINT recipe_components_pkey PRIMARY KEY (id);
  END IF;
END $$;

ALTER TABLE recipe_components
  ALTER COLUMN component_recipe_id DROP NOT NULL;

ALTER TABLE recipe_components
  ADD COLUMN IF NOT EXISTS ingredient_id uuid REFERENCES ingredients (id);

-- Rewritten: a NULL component_recipe_id (an ingredient-target row) can never
-- violate self-reference, so the check only applies when it's set.
ALTER TABLE recipe_components
  DROP CONSTRAINT IF EXISTS recipe_components_not_self_chk;

ALTER TABLE recipe_components
  ADD CONSTRAINT recipe_components_not_self_chk
    CHECK (component_recipe_id IS NULL OR assembly_recipe_id <> component_recipe_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'recipe_components_exactly_one_target_chk'
      AND conrelid = 'recipe_components'::regclass
  ) THEN
    ALTER TABLE recipe_components
      ADD CONSTRAINT recipe_components_exactly_one_target_chk
      CHECK (
        (component_recipe_id IS NOT NULL AND ingredient_id IS NULL)
        OR (component_recipe_id IS NULL AND ingredient_id IS NOT NULL)
      );
  END IF;
END $$;

-- Replaces the duplicate-prevention role the old composite PRIMARY KEY
-- (assembly_recipe_id, component_recipe_id) used to play -- now split by
-- target column, each partial so it only applies to rows of that kind.
CREATE UNIQUE INDEX IF NOT EXISTS recipe_components_assembly_component_uidx
  ON recipe_components (assembly_recipe_id, component_recipe_id)
  WHERE component_recipe_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS recipe_components_assembly_ingredient_uidx
  ON recipe_components (assembly_recipe_id, ingredient_id)
  WHERE ingredient_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS recipe_components_ingredient_id_idx
  ON recipe_components (ingredient_id);

-- ---------------------------------------------------------------------------
-- 2. enforce_recipe_component_roles -- component-role check only applies
--    when component_recipe_id is set; ingredient_id rows only need to
--    confirm the ingredient exists.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_recipe_component_roles()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_assembly_role text;
  v_component_role text;
  v_ingredient_exists boolean;
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

  IF NEW.component_recipe_id IS NOT NULL THEN
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
  END IF;

  IF NEW.ingredient_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM ingredients WHERE id = NEW.ingredient_id
    ) INTO v_ingredient_exists;

    IF NOT v_ingredient_exists THEN
      RAISE EXCEPTION 'Ingredient % was not found.', NEW.ingredient_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. confirm_sale -- assembly branch now walks every recipe_components row,
--    not only component_recipe_id ones. Full text replaced (CREATE OR
--    REPLACE) per sql/085's own precedent -- only the assembly branch body
--    and the trailing COMMENT actually change; everything else (shift
--    auto-open, component branch, return shape) is carried forward
--    byte-for-byte from sql/085.
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

      -- Walk every recipe_components row for this assembly -- a row is
      -- either a Component recipe (FIFO-allocated finished good) or a raw
      -- ingredient (decremented directly). recipe_components_exactly_one_target_chk
      -- guarantees exactly one of component_recipe_id / ingredient_id is
      -- set per row, so the LEFT JOINs below never produce a name for
      -- both at once.
      FOR v_component IN
        SELECT
          rc.component_recipe_id,
          rc.ingredient_id,
          rc.quantity AS bom_quantity,
          r.name AS component_name,
          ing.name AS ingredient_name,
          ing.cost_per_unit AS ingredient_cost_per_unit
        FROM recipe_components rc
        LEFT JOIN recipes r ON r.id = rc.component_recipe_id
        LEFT JOIN ingredients ing ON ing.id = rc.ingredient_id
        WHERE rc.assembly_recipe_id = v_line.product_id
        ORDER BY rc.id
      LOOP
        v_has_components := true;
        v_required_qty := round(v_component.bom_quantity * v_line.quantity, 3);

        IF v_component.component_recipe_id IS NOT NULL THEN
          BEGIN
            v_allocation := allocate_finished_goods_fifo(
              v_component.component_recipe_id,
              v_required_qty,
              'sale', 'sale_line', v_line.id
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

        ELSIF v_component.ingredient_id IS NOT NULL THEN
          -- New: raw ingredient add-in, no production cycle. Same
          -- decrement primitive complete_production_session already uses
          -- (lock + sufficiency check), plus an immutable stock_movements
          -- row -- direct sale consumption must leave the same audit trail
          -- production does, no exceptions.
          BEGIN
            PERFORM decrement_ingredient_stock(
              v_component.ingredient_id,
              v_required_qty
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION
              'Failed to consume ingredient "%" while assembling "%": %',
              v_component.ingredient_name,
              v_recipe_name,
              SQLERRM;
          END;

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
            v_component.ingredient_id,
            NULL,
            'sale_out',
            v_required_qty,
            COALESCE(v_component.ingredient_cost_per_unit, 0),
            NULL,
            'sale',
            v_line.id,
            v_now,
            v_now
          );

          v_total_cogs := v_total_cogs
            + (v_required_qty * COALESCE(v_component.ingredient_cost_per_unit, 0));
        END IF;
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
  'Confirm a draft sale: ensure a shift is open (auto-opening one if none is), fulfill each line per its product recipe_role (component: direct FIFO; assembly: walk every recipe_components row -- component_recipe_id entries FIFO-allocate finished goods from production_batches, ingredient_id entries decrement ingredients.current_stock directly and append a stock_movements row). COGS comes from FIFO allocation totals plus direct ingredient consumption cost.';

-- anon holds its own direct grant on this project independent of PUBLIC
-- membership (see sql/074) -- both must be revoked explicitly (lesson from
-- the first failed rollout attempt of sql/076, carried forward by sql/085).
REVOKE ALL ON FUNCTION confirm_sale(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_sale(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION confirm_sale(uuid) TO authenticated;
