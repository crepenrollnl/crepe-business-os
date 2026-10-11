-- Kitchen-queue RPCs for sales (audit S1, step 2a of 2).
-- Run in the Supabase SQL editor after sql/138_rls_close_direct_writes_step1.sql.
-- Apply on both databases (dev + prod). Idempotent CREATE OR REPLACE.
-- No BEGIN/COMMIT here.
--
-- Today the browser writes sales.fulfilled_at directly through the open
-- policy sales_authenticated_all (FOR ALL USING true):
--   markSaleQueued    UPDATE sales SET fulfilled_at = NULL  WHERE id = … AND fulfilled_at IS NOT NULL
--   markSaleFulfilled UPDATE sales SET fulfilled_at = now() WHERE id = … AND fulfilled_at IS NULL
-- These are the ONLY direct client writes to sales (S1 investigation,
-- 2026-10-11). This file adds two SECURITY DEFINER RPCs that do exactly the
-- same, so the app can switch to them; a later file (step 2b) then closes
-- direct writes on sales. Nothing is closed here, so the app keeps working
-- before and after its switch.
--
-- Same semantics as the client calls, plus:
--   - only a signed-in user with an active profile (owner, partner or
--     seller — sellers run the POS and the kitchen queue);
--   - only confirmed or paid sales (a draft or cancelled sale has no
--     kitchen ticket);
--   - the server clock sets fulfilled_at, not the browser;
--   - a call that finds the sale already in the wanted state changes
--     nothing and is not an error (same as the client .not()/.is() filter).
-- Only sales.fulfilled_at changes. status, totals, is_paid, notes,
-- updated_at, stock and journals are untouched (same as today).
--
-- Returns jsonb { id, fulfilled_at, changed }.

CREATE OR REPLACE FUNCTION mark_sale_queued(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status text;
  v_fulfilled_at timestamptz;
  v_changed boolean := false;
BEGIN
  PERFORM require_role('owner', 'partner', 'seller');

  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale id is required.';
  END IF;

  SELECT status, fulfilled_at
  INTO v_status, v_fulfilled_at
  FROM sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale was not found.';
  END IF;

  IF v_status NOT IN ('confirmed', 'paid') THEN
    RAISE EXCEPTION 'Only a confirmed sale can be sent to the kitchen queue (status: %).', v_status;
  END IF;

  IF v_fulfilled_at IS NOT NULL THEN
    UPDATE sales SET fulfilled_at = NULL WHERE id = p_sale_id;
    v_fulfilled_at := NULL;
    v_changed := true;
  END IF;

  RETURN jsonb_build_object(
    'id', p_sale_id,
    'fulfilled_at', v_fulfilled_at,
    'changed', v_changed
  );
END;
$function$;

COMMENT ON FUNCTION mark_sale_queued(uuid) IS
  'Kitchen queue: put a confirmed/paid sale into the queue (sales.fulfilled_at := NULL). No-op if already queued. Owner, partner or seller. Changes nothing else.';

REVOKE ALL ON FUNCTION mark_sale_queued(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_sale_queued(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION mark_sale_queued(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION mark_sale_fulfilled(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status text;
  v_fulfilled_at timestamptz;
  v_changed boolean := false;
BEGIN
  PERFORM require_role('owner', 'partner', 'seller');

  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale id is required.';
  END IF;

  SELECT status, fulfilled_at
  INTO v_status, v_fulfilled_at
  FROM sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale was not found.';
  END IF;

  IF v_status NOT IN ('confirmed', 'paid') THEN
    RAISE EXCEPTION 'Only a confirmed sale can be marked as ready (status: %).', v_status;
  END IF;

  IF v_fulfilled_at IS NULL THEN
    v_fulfilled_at := now();
    UPDATE sales SET fulfilled_at = v_fulfilled_at WHERE id = p_sale_id;
    v_changed := true;
  END IF;

  RETURN jsonb_build_object(
    'id', p_sale_id,
    'fulfilled_at', v_fulfilled_at,
    'changed', v_changed
  );
END;
$function$;

COMMENT ON FUNCTION mark_sale_fulfilled(uuid) IS
  'Kitchen queue: mark a queued confirmed/paid sale as ready (sales.fulfilled_at := now(), server clock). No-op if already ready. Owner, partner or seller. Changes nothing else.';

REVOKE ALL ON FUNCTION mark_sale_fulfilled(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_sale_fulfilled(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION mark_sale_fulfilled(uuid) TO authenticated;
