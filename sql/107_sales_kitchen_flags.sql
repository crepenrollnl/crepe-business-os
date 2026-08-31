-- Backfill into git (same class as sql/000, sql/101, sql/106).
-- Already applied to both live databases via SQL Editor; commit 2cc45ed
-- shipped the TypeScript callers without this file. This commit only
-- closes the git gap. Re-run is a no-op (IF NOT EXISTS / CREATE OR REPLACE
-- / DROP IF EXISTS). Body is the file that was applied: set_sale_paid_flag,
-- 3-arg create_draft_sale / create_and_confirm_sale, and the kitchen views
-- with fulfilled_at / is_paid / kitchen_note.
--
-- Kitchen-queue payment flag + kitchen note on sales
-- Run in Supabase SQL editor after sql/104_sales_fulfilled_at.sql
-- (and after sql/106 if that file is already applied — numbering is sequential).
-- Apply on both databases (dev + prod), as with every previous sql/*.sql.
--
-- Phase 5.x of the project plan. Additive. Re-run:
--   ADD COLUMN IF NOT EXISTS is a no-op;
--   CREATE OR REPLACE covers the new 3-arg RPC signatures after the old
--   2-arg overloads are dropped once.
--
-- Locked decisions (do not "fix" these in a follow-up without an ADR):
--   A. Payment = sales.is_paid boolean NOT NULL DEFAULT false.
--      Does NOT touch sales.status, sales.paid_at, or confirm_sale.
--   B. Kitchen note = sales.kitchen_note text.
--      Does NOT reuse sales.notes.
--
-- Does NOT:
--   - change confirm_sale, FIFO allocation, or journal posting
--   - change sales.notes / sales.status / sales.paid_at
--   - apply itself (this file is a draft until run in the SQL editor)

-- ---------------------------------------------------------------------------
-- 1. sales.is_paid / sales.kitchen_note
-- ---------------------------------------------------------------------------

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS is_paid boolean NOT NULL DEFAULT false;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS kitchen_note text;

COMMENT ON COLUMN sales.is_paid IS
  'UI/kitchen-only payment flag for the order queue. NOT NULL DEFAULT false. Does not participate in sales.status, sales.paid_at, confirm_sale, FIFO, journals, or Accounting. Never treat this as settlement or AR.';

COMMENT ON COLUMN sales.kitchen_note IS
  'UI/kitchen-only note shown on the order-queue ticket. Separate from sales.notes. Does not participate in sales.status, sales.paid_at, confirm_sale, FIFO, journals, or Accounting.';

-- ---------------------------------------------------------------------------
-- 2. set_sale_paid_flag — updates is_paid only
--
-- SECURITY DEFINER so this path does not rely on sales_authenticated_all
-- (that policy is FOR ALL USING true; it cannot restrict which columns a
-- client UPDATE may touch). This RPC is the only writer of is_paid.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_sale_paid_flag(
  p_sale_id uuid,
  p_is_paid boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale id is required.';
  END IF;

  IF p_is_paid IS NULL THEN
    RAISE EXCEPTION 'Payment flag is required.';
  END IF;

  UPDATE sales
  SET is_paid = p_is_paid
  WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale was not found.';
  END IF;
END;
$$;

COMMENT ON FUNCTION set_sale_paid_flag(uuid, boolean) IS
  'UI/kitchen-only: set sales.is_paid. Does not change status, paid_at, fulfilled_at, notes, kitchen_note, confirm_sale, FIFO, or journals.';

REVOKE ALL ON FUNCTION set_sale_paid_flag(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_sale_paid_flag(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION set_sale_paid_flag(uuid, boolean) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. create_draft_sale — persist kitchen_note (not notes)
--
-- Latest live body is sql/018 (active-customer guard), not sql/016.
-- Adding p_kitchen_note text DEFAULT NULL is a new argument list, so the
-- old (uuid, text) overload must be dropped: CREATE OR REPLACE cannot
-- change the number of arguments.
-- Existing two-argument calls (p_customer_id, p_notes) keep working via
-- the DEFAULT.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS create_draft_sale(uuid, text);

CREATE OR REPLACE FUNCTION create_draft_sale(
  p_customer_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_kitchen_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_sale_number text;
  v_notes text;
  v_kitchen_note text;
  v_customer customers%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_kitchen_note := NULLIF(btrim(COALESCE(p_kitchen_note, '')), '');

  IF p_customer_id IS NOT NULL THEN
    SELECT *
    INTO v_customer
    FROM customers
    WHERE id = p_customer_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer was not found.';
    END IF;

    IF v_customer.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Inactive customers cannot be selected for new draft sales.';
    END IF;
  END IF;

  v_sale_number := 'S-' || lpad(nextval('sales_sale_number_seq')::text, 6, '0');

  INSERT INTO sales (
    sale_number,
    customer_id,
    status,
    sale_date,
    notes,
    kitchen_note,
    subtotal,
    tax_total,
    total,
    created_at,
    updated_at
  )
  VALUES (
    v_sale_number,
    p_customer_id,
    'draft',
    CURRENT_DATE,
    v_notes,
    v_kitchen_note,
    0,
    0,
    0,
    v_now,
    v_now
  )
  RETURNING id INTO v_sale_id;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id
  );
END;
$$;

COMMENT ON FUNCTION create_draft_sale(uuid, text, text) IS
  'Create a draft sale header only (no lines). Guest sales allowed (null customer_id). Non-null customer_id must reference an active customer. p_kitchen_note writes sales.kitchen_note, never sales.notes.';

REVOKE ALL ON FUNCTION create_draft_sale(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_draft_sale(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION create_draft_sale(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. create_and_confirm_sale — pass kitchen_note through to the draft
--
-- Body is sql/086 plus p_kitchen_note. confirm_sale / add_sale_line /
-- FIFO / journals are called unchanged.
-- Same DROP + 3-arg recreate as create_draft_sale.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS create_and_confirm_sale(uuid, jsonb);

CREATE OR REPLACE FUNCTION create_and_confirm_sale(
  p_customer_id uuid DEFAULT NULL,
  p_lines jsonb DEFAULT NULL,
  p_kitchen_note text DEFAULT NULL
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

  -- Reuse create_draft_sale (sale_number generation, draft header insert,
  -- active-customer guard). Commercial notes stay NULL on this path;
  -- kitchen_note is the Quick Sale / POS queue note only.
  v_draft := create_draft_sale(p_customer_id, NULL, p_kitchen_note);
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

COMMENT ON FUNCTION create_and_confirm_sale(uuid, jsonb, text) IS
  'One-tap sale: atomically create a draft sale, add every line in p_lines ({product_id, quantity, unit_price}[]), then confirm it. Optional p_kitchen_note is stored on sales.kitchen_note only — not sales.notes. Reuses create_draft_sale + add_sale_line + confirm_sale unchanged; does not duplicate FIFO allocation, shift auto-open, or validation.';

REVOKE ALL ON FUNCTION create_and_confirm_sale(uuid, jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_and_confirm_sale(uuid, jsonb, text) FROM anon;
GRANT EXECUTE ON FUNCTION create_and_confirm_sale(uuid, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Read views — sql/104 shape plus is_paid / kitchen_note
--
-- CREATE OR REPLACE VIEW can drop reloptions; restore security_invoker
-- as set by sql/074 so RLS on sales/sale_lines is not bypassed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW sales_list_view AS
SELECT
  s.id AS sale_id,
  s.sale_number,
  s.status,
  s.sale_date,
  s.customer_id,
  s.subtotal,
  s.tax_total,
  s.total,
  s.confirmed_at,
  s.paid_at,
  s.cancelled_at,
  s.fulfilled_at,
  s.is_paid,
  s.kitchen_note
FROM sales s;

COMMENT ON VIEW sales_list_view IS
  'Read-only Sales list. One row per sale. No lines, FIFO, ledger, or COGS.';

GRANT SELECT ON sales_list_view TO authenticated;
ALTER VIEW sales_list_view SET (security_invoker = true);

CREATE OR REPLACE VIEW sale_details_view AS
SELECT
  s.id AS sale_id,
  s.sale_number,
  s.status,
  s.sale_date,
  s.customer_id,
  s.subtotal,
  s.tax_total,
  s.total,
  s.confirmed_at,
  s.paid_at,
  s.cancelled_at,
  sl.id AS line_id,
  sl.product_id,
  sl.quantity,
  sl.unit_price,
  sl.line_total,
  s.fulfilled_at,
  s.is_paid,
  s.kitchen_note
FROM sales s
LEFT JOIN sale_lines sl
  ON sl.sale_id = s.id;

COMMENT ON VIEW sale_details_view IS
  'Read-only Sale details. Header + lines per row. No FIFO, ledger, or COGS.';

GRANT SELECT ON sale_details_view TO authenticated;
ALTER VIEW sale_details_view SET (security_invoker = true);
