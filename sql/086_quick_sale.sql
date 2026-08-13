-- Quick Sale — one-tap sale foundation, Step 1 (migration + RPC only)
-- Run in Supabase SQL editor after sql/085_recipe_assembly_layer.sql.
--
-- This is schema + RPC only. No UI in this step (separate follow-up task).
--
-- 1. recipes.selling_price — optional per-recipe list price, so a future
--    "tap to sell" UI can pre-fill unit_price instead of manual entry
--    every time. Nullable: not every recipe has to have a price set
--    immediately.
--
-- 2. create_and_confirm_sale — one atomic RPC composing the three existing,
--    independent sale RPCs (create_draft_sale -> add_sale_line (once per
--    line) -> confirm_sale) into a single transaction, so a one-tap UI
--    never leaves a half-created draft sale behind if something fails
--    partway through. Same "one RPC = one atomic business operation"
--    pattern already used by confirm_production_plan (sql/078) and
--    complete_production_session (sql/007).
--
-- Does NOT:
--   - change create_draft_sale, add_sale_line, or confirm_sale themselves
--     (this function only calls them — their FIFO allocation, auto-open-
--     shift, and accounting-posting behavior is reused exactly as is)
--   - add a create_recipe / update_recipe RPC parameter for selling_price
--     (no such RPC exists — see the investigation note in this session:
--     recipe create/update goes through recipe-service.ts's persistRecipe()
--     directly against the recipes table, not a SECURITY DEFINER RPC.
--     Wiring selling_price into that create/edit flow is TS-service + UI
--     work, out of scope for this migration-only step.)
--   - create UI, hooks, or services

-- ---------------------------------------------------------------------------
-- 1. recipes.selling_price
-- ---------------------------------------------------------------------------

ALTER TABLE recipes
  ADD COLUMN IF NOT EXISTS selling_price numeric(12, 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'recipes_selling_price_non_negative'
  ) THEN
    ALTER TABLE recipes
      ADD CONSTRAINT recipes_selling_price_non_negative
      CHECK (selling_price IS NULL OR selling_price >= 0);
  END IF;
END $$;

COMMENT ON COLUMN recipes.selling_price IS
  'Optional list price for this product. Nullable -- not every recipe has one yet. A sale line''s unit_price is still whatever is passed to add_sale_line / create_and_confirm_sale at the time of sale; this column is a future UI default, never read by confirm_sale or FIFO allocation.';

-- ---------------------------------------------------------------------------
-- 2. create_and_confirm_sale
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_and_confirm_sale(
  p_customer_id uuid DEFAULT NULL,
  p_lines jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft jsonb;
  v_sale_id uuid;
  v_line jsonb;
BEGIN
  -- Same guard confirm_sale itself raises on zero lines -- checked early
  -- here too so a lineless call never creates an orphan draft sale row
  -- before failing (the transaction would roll that back anyway, but the
  -- earlier check gives a clearer failure and skips the wasted work).
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Sale has no lines to confirm.';
  END IF;

  -- Reuse create_draft_sale exactly as is (sale_number generation, draft
  -- header insert). Notes are not part of the quick-sale shape.
  v_draft := create_draft_sale(p_customer_id, NULL);
  v_sale_id := (v_draft ->> 'sale_id')::uuid;

  -- Reuse add_sale_line exactly as is, once per line -- its own validation
  -- (product must exist and be active, quantity > 0, unit_price >= 0,
  -- sale must still be draft) applies unchanged to every line.
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    PERFORM add_sale_line(
      v_sale_id,
      (v_line ->> 'product_id')::uuid,
      (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price')::numeric
    );
  END LOOP;

  -- Reuse confirm_sale exactly as is -- FIFO finished-goods allocation,
  -- auto-open-shift, and (via the caller's normal TS flow) optional
  -- accounting posting all happen exactly as they do for a manually
  -- built draft sale. Not reimplemented here.
  RETURN confirm_sale(v_sale_id);
END;
$$;

COMMENT ON FUNCTION create_and_confirm_sale(uuid, jsonb) IS
  'One-tap sale: atomically create a draft sale, add every line in p_lines ({product_id, quantity, unit_price}[]), then confirm it -- composes create_draft_sale + add_sale_line + confirm_sale in a single transaction so no half-created draft sale can be left behind. Reuses those functions'' existing logic unchanged; does not duplicate FIFO allocation, shift auto-open, or validation.';

-- Money-critical: creates a sale, mutates finished goods via FIFO
-- allocation, and (through the same confirm_sale path used everywhere
-- else) can be the trigger for a real accounting journal entry. Same
-- REVOKE/GRANT pattern as every other money-critical RPC this session.
REVOKE ALL ON FUNCTION create_and_confirm_sale(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_and_confirm_sale(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION create_and_confirm_sale(uuid, jsonb) TO authenticated;
