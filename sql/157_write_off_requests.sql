-- sql/157 — audit S4/U5, last step before seller accounts: write-off
-- requests. A seller reports what was thrown away; nothing changes in stock
-- or the books until the owner or a partner approves it.
--
-- Mykola's decisions (14.10 and 15.10):
--   - a seller may request a write-off of an ingredient (raw material), a
--     finished good (component: batter, filling, sauce) or a dish (a crepe:
--     on approval every part of it is written off by its recipe);
--   - the owner or a partner approves or rejects; when approving they may
--     correct the quantity;
--   - approval goes through the existing record_write_off /
--     record_dish_write_off (sql/115, 127, 147, 148), so stock, FIFO costs and
--     the automatic journal work exactly as for a write-off made by the owner.
--
-- New:
--   write_off_requests        one row per request; no cost columns at all.
--   write_off_request_list    the list the app reads (item name and unit
--                             added; quantities only). A seller sees only
--                             their own requests, owner/partner see all.
--   request_write_off(...)          owner, partner, seller
--   approve_write_off_request(...)  owner, partner (optional new quantity)
--   reject_write_off_request(...)   owner, partner (optional note)
--
-- Nothing existing is changed. Re-running stops at the precheck.

DO $pre157$
BEGIN
  IF to_regprocedure('public.require_role(text[])') IS NULL
     OR to_regprocedure('public.get_my_role()') IS NULL
     OR to_regprocedure('public.record_write_off(text, uuid, uuid, numeric, text, text)') IS NULL
     OR to_regprocedure('public.record_dish_write_off(uuid, numeric, text, text)') IS NULL
     OR to_regclass('public.ingredient_stock_levels') IS NULL
     OR to_regclass('public.ingredients') IS NULL
     OR to_regclass('public.recipes') IS NULL THEN
    RAISE EXCEPTION 'sql/157: expected objects are missing (sql/155 applied?)';
  END IF;
  IF to_regclass('public.write_off_requests') IS NOT NULL
     OR to_regclass('public.write_off_request_list') IS NOT NULL
     OR to_regproc('public.request_write_off') IS NOT NULL
     OR to_regproc('public.approve_write_off_request') IS NOT NULL
     OR to_regproc('public.reject_write_off_request') IS NOT NULL THEN
    RAISE EXCEPTION 'sql/157: already applied';
  END IF;
END;
$pre157$;

CREATE TABLE public.write_off_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL
    CHECK (item_type IN ('ingredient', 'finished_good', 'dish')),
  ingredient_id uuid REFERENCES public.ingredients (id),
  product_id uuid REFERENCES public.recipes (id),
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0 AND quantity <= 1000),
  reason text NOT NULL
    CHECK (reason IN ('spoilage', 'damaged', 'quality_reject', 'staff_use', 'theft', 'other')),
  note text CHECK (note IS NULL OR length(note) <= 500),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  client_request_id uuid UNIQUE,
  decided_by uuid,
  decided_at timestamptz,
  approved_quantity numeric(12, 3),
  decision_note text CHECK (decision_note IS NULL OR length(decision_note) <= 500),
  write_off_ids uuid[],
  CONSTRAINT write_off_requests_item_target_chk CHECK (
    (item_type = 'ingredient' AND ingredient_id IS NOT NULL AND product_id IS NULL)
    OR (item_type IN ('finished_good', 'dish') AND product_id IS NOT NULL AND ingredient_id IS NULL)
  ),
  CONSTRAINT write_off_requests_decision_chk CHECK (
    (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL
       AND approved_quantity IS NULL AND write_off_ids IS NULL)
    OR (status = 'approved' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
       AND approved_quantity > 0 AND approved_quantity <= 1000
       AND cardinality(write_off_ids) > 0)
    OR (status = 'rejected' AND decided_by IS NOT NULL AND decided_at IS NOT NULL
       AND approved_quantity IS NULL AND write_off_ids IS NULL)
  )
);

CREATE INDEX write_off_requests_pending_idx
  ON public.write_off_requests (requested_at) WHERE status = 'pending';
CREATE INDEX write_off_requests_requested_by_idx
  ON public.write_off_requests (requested_by, requested_at DESC);

ALTER TABLE public.write_off_requests ENABLE ROW LEVEL SECURITY;

-- Owner/partner see every request; anyone else with an active role sees
-- only their own. All writes go through the RPCs below.
CREATE POLICY write_off_requests_select ON public.write_off_requests
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('owner', 'partner')
         OR (public.get_my_role() IS NOT NULL AND requested_by = auth.uid()));

REVOKE ALL ON public.write_off_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.write_off_requests TO authenticated;

CREATE VIEW public.write_off_request_list
WITH (security_invoker = true) AS
SELECT r.id,
       r.item_type,
       r.ingredient_id,
       r.product_id,
       COALESCE(i.name, rc.name) AS item_name,
       CASE WHEN r.item_type = 'ingredient' THEN i.unit ELSE rc.yield_unit END AS unit,
       r.quantity,
       r.approved_quantity,
       r.reason,
       r.note,
       r.status,
       r.requested_by,
       r.requested_at,
       r.decided_by,
       r.decided_at,
       r.decision_note,
       (r.requested_by = auth.uid()) AS is_mine
FROM public.write_off_requests r
LEFT JOIN public.ingredient_stock_levels i ON i.id = r.ingredient_id
LEFT JOIN public.recipes rc ON rc.id = r.product_id;

REVOKE ALL ON public.write_off_request_list FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.write_off_request_list TO authenticated;

-- ---------------------------------------------------------------------
-- request_write_off: create a pending request. Changes no stock.
-- p_item_id is the ingredient id for 'ingredient', the recipe id otherwise.
-- A repeated call with the same p_client_request_id returns the first
-- request (double tap / retry after a lost response).
-- ---------------------------------------------------------------------
CREATE FUNCTION public.request_write_off(
  p_item_type text,
  p_item_id uuid,
  p_quantity numeric,
  p_reason text,
  p_note text DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_role text;
  v_existing write_off_requests%ROWTYPE;
  v_quantity numeric(12, 3);
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_recipe_role text;
  v_id uuid;
BEGIN
  PERFORM require_role('owner', 'partner', 'seller');

  IF p_client_request_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM write_off_requests
    WHERE client_request_id = p_client_request_id;
    IF FOUND THEN
      IF v_existing.requested_by IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'This request token belongs to another user.';
      END IF;
      RETURN jsonb_build_object('id', v_existing.id, 'status', v_existing.status);
    END IF;
  END IF;

  IF p_item_type IS NULL OR p_item_type NOT IN ('ingredient', 'finished_good', 'dish') THEN
    RAISE EXCEPTION 'Choose what to write off: ingredient, finished good or dish.';
  END IF;
  IF p_item_id IS NULL THEN
    RAISE EXCEPTION 'Choose the item to write off.';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Write-off quantity must be greater than zero.';
  END IF;
  v_quantity := round(p_quantity, 3);
  IF v_quantity <= 0 OR v_quantity > 1000 THEN
    RAISE EXCEPTION 'Quantity must be between 0.001 and 1000.';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN (
    'spoilage', 'damaged', 'quality_reject', 'staff_use', 'theft', 'other'
  ) THEN
    RAISE EXCEPTION 'Write-off reason is invalid.';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'Note is too long (500 characters at most).';
  END IF;

  IF p_item_type = 'ingredient' THEN
    IF NOT EXISTS (SELECT 1 FROM ingredients WHERE id = p_item_id) THEN
      RAISE EXCEPTION 'Ingredient was not found.';
    END IF;
  ELSE
    SELECT recipe_role INTO v_recipe_role FROM recipes WHERE id = p_item_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product was not found.';
    END IF;
    IF p_item_type = 'dish' AND v_recipe_role IS DISTINCT FROM 'assembly' THEN
      RAISE EXCEPTION 'This is not a dish. Choose it under finished goods.';
    END IF;
    IF p_item_type = 'finished_good' AND v_recipe_role = 'assembly' THEN
      RAISE EXCEPTION 'This is a dish. Choose it under dishes.';
    END IF;
  END IF;

  INSERT INTO write_off_requests (
    item_type, ingredient_id, product_id, quantity, reason, note,
    requested_by, client_request_id
  )
  VALUES (
    p_item_type,
    CASE WHEN p_item_type = 'ingredient' THEN p_item_id END,
    CASE WHEN p_item_type <> 'ingredient' THEN p_item_id END,
    v_quantity, p_reason, v_note, auth.uid(), p_client_request_id
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'status', 'pending');
END;
$function$;

-- ---------------------------------------------------------------------
-- approve_write_off_request: owner/partner. Writes off through the
-- existing RPCs (stock, FIFO cost, automatic journal), optionally with a
-- corrected quantity. If the write-off itself fails (not enough stock, no
-- cost), nothing changes and the request stays pending.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.approve_write_off_request(
  p_request_id uuid,
  p_quantity numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_req write_off_requests%ROWTYPE;
  v_quantity numeric(12, 3);
  v_note text;
  v_result jsonb;
  v_ids uuid[];
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Write-off request id is required.';
  END IF;

  SELECT * INTO v_req FROM write_off_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Write-off request was not found.';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is already %.', v_req.status;
  END IF;

  IF p_quantity IS NOT NULL AND p_quantity <= 0 THEN
    RAISE EXCEPTION 'Write-off quantity must be greater than zero.';
  END IF;
  v_quantity := round(COALESCE(p_quantity, v_req.quantity), 3);
  IF v_quantity <= 0 OR v_quantity > 1000 THEN
    RAISE EXCEPTION 'Quantity must be between 0.001 and 1000.';
  END IF;

  v_note := concat_ws(' — ', 'Seller request', v_req.note);

  IF v_req.item_type = 'dish' THEN
    v_result := record_dish_write_off(v_req.product_id, v_quantity, v_req.reason, v_note);
    SELECT array_agg((w ->> 'id')::uuid ORDER BY ord)
    INTO v_ids
    FROM jsonb_array_elements(v_result -> 'write_offs') WITH ORDINALITY AS t(w, ord);
  ELSE
    v_result := record_write_off(v_req.item_type, v_req.ingredient_id, v_req.product_id,
                                 v_quantity, v_req.reason, v_note);
    v_ids := ARRAY[(v_result ->> 'id')::uuid];
  END IF;

  UPDATE write_off_requests
  SET status = 'approved',
      decided_by = auth.uid(),
      decided_at = now(),
      approved_quantity = v_quantity,
      write_off_ids = v_ids
  WHERE id = v_req.id;

  RETURN jsonb_build_object(
    'id', v_req.id,
    'status', 'approved',
    'approved_quantity', v_quantity,
    'write_off', v_result
  );
END;
$function$;

-- ---------------------------------------------------------------------
-- reject_write_off_request: owner/partner. Changes no stock.
-- ---------------------------------------------------------------------
CREATE FUNCTION public.reject_write_off_request(
  p_request_id uuid,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_req write_off_requests%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Write-off request id is required.';
  END IF;
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'Note is too long (500 characters at most).';
  END IF;

  SELECT * INTO v_req FROM write_off_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Write-off request was not found.';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION 'This request is already %.', v_req.status;
  END IF;

  UPDATE write_off_requests
  SET status = 'rejected',
      decided_by = auth.uid(),
      decided_at = now(),
      decision_note = v_note
  WHERE id = v_req.id;

  RETURN jsonb_build_object('id', v_req.id, 'status', 'rejected');
END;
$function$;

REVOKE ALL ON FUNCTION public.request_write_off(text, uuid, numeric, text, text, uuid),
                       public.approve_write_off_request(uuid, numeric),
                       public.reject_write_off_request(uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_write_off(text, uuid, numeric, text, text, uuid),
                          public.approve_write_off_request(uuid, numeric),
                          public.reject_write_off_request(uuid, text)
  TO authenticated;
