-- Write off a whole dish (assembly recipe) in one step.
-- Run in the Supabase SQL editor after sql/135_receipt_recognition.sql.
-- Apply on both databases (dev + prod). Idempotent CREATE OR REPLACE.
-- No BEGIN/COMMIT in this file.
--
-- A dish is made to order and is never stocked (sql/085): confirm_sale
-- consumes its recipe_components at the moment of sale. A dish that was
-- made and thrown away, or eaten by staff, has no stock row of its own,
-- so it is written off as its parts.
--
-- record_dish_write_off reads recipe_components exactly like the assembly
-- branch of confirm_sale (sql/120): same ORDER BY rc.id, same
-- round(bom_quantity * quantity, 3). Each part is written off through the
-- unchanged record_write_off (sql/127), so every guard there still applies
-- (owner/partner, zero-cost ingredient, zero-cost FIFO layer, stock checks)
-- and every part is an ordinary write_offs row with its own journal in the
-- app. The rows share one note "Dish: <name> × <qty>[ — <user note>]".
-- One call is one transaction: any failing part rolls back every part.
--
-- SECURITY DEFINER with require_role first, same shape as record_write_off.
--
-- Does NOT:
--   - change record_write_off, confirm_sale, allocate_finished_goods_fifo
--   - change the write_offs table or its policies
--   - post journals (the app posts one per returned write-off row)

CREATE OR REPLACE FUNCTION record_dish_write_off(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_name text;
  v_role text;
  v_quantity numeric(12, 3);
  v_user_note text;
  v_note text;
  v_part record;
  v_part_name text;
  v_required numeric;
  v_result jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_count integer := 0;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Choose a dish to write off.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Write-off quantity must be greater than zero.';
  END IF;

  v_quantity := round(p_quantity, 3);

  IF v_quantity <= 0 OR v_quantity > 1000 THEN
    RAISE EXCEPTION 'Dish quantity must be between 0.001 and 1000.';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN (
    'spoilage',
    'damaged',
    'quality_reject',
    'staff_use',
    'theft',
    'other'
  ) THEN
    RAISE EXCEPTION 'Write-off reason is invalid.';
  END IF;

  SELECT name, recipe_role
  INTO v_name, v_role
  FROM recipes
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dish was not found.';
  END IF;

  IF v_role IS DISTINCT FROM 'assembly' THEN
    RAISE EXCEPTION
      '"%" is not a dish. Write off components under Finished Goods.',
      v_name;
  END IF;

  v_user_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_note := 'Dish: ' || v_name || ' × ' || trim_scale(v_quantity)::text
    || CASE WHEN v_user_note IS NULL THEN '' ELSE ' — ' || v_user_note END;

  FOR v_part IN
    SELECT
      rc.component_recipe_id,
      rc.ingredient_id,
      rc.quantity AS bom_quantity,
      r.name AS component_name,
      ing.name AS ingredient_name
    FROM recipe_components rc
    LEFT JOIN recipes r ON r.id = rc.component_recipe_id
    LEFT JOIN ingredients ing ON ing.id = rc.ingredient_id
    WHERE rc.assembly_recipe_id = p_product_id
    ORDER BY rc.id
  LOOP
    v_part_name := COALESCE(v_part.component_name, v_part.ingredient_name, 'part');
    v_required := round(v_part.bom_quantity * v_quantity, 3);

    IF v_required <= 0 THEN
      RAISE EXCEPTION
        'Quantity is too small: "%" in "%" would round to zero.',
        v_part_name,
        v_name;
    END IF;

    BEGIN
      IF v_part.component_recipe_id IS NOT NULL THEN
        v_result := record_write_off(
          'finished_good',
          NULL,
          v_part.component_recipe_id,
          v_required,
          p_reason,
          v_note
        );
      ELSE
        v_result := record_write_off(
          'ingredient',
          v_part.ingredient_id,
          NULL,
          v_required,
          p_reason,
          v_note
        );
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION
          'Could not write off "%" for dish "%": %',
          v_part_name,
          v_name,
          SQLERRM;
    END;

    v_rows := v_rows || jsonb_build_array(v_result);
    v_total := v_total + COALESCE((v_result ->> 'total_value')::numeric, 0);
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION
      'Dish "%" has no components defined and cannot be written off.',
      v_name;
  END IF;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'quantity', v_quantity,
    'total_value', round(v_total, 4),
    'write_offs', v_rows
  );
END;
$function$;

COMMENT ON FUNCTION record_dish_write_off(uuid, numeric, text, text) IS
  'Write off a dish (assembly recipe) as its recipe_components, one record_write_off per part, in one transaction. Same parts and rounding as confirm_sale. Returns the write-off rows for journal posting. Requires owner or partner.';

REVOKE ALL ON FUNCTION record_dish_write_off(uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_dish_write_off(uuid, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION record_dish_write_off(uuid, numeric, text, text) TO authenticated;
