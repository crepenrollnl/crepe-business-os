-- sql/150 — audit D2/K3, step 4 (last flow): purchase journals are posted by
-- the DATABASE at COMMIT, like sales (147), write-offs (148), production (149).
--
-- Why: today the browser posts the purchase journal after receive_purchase
-- returns. A closed tablet leaves a received purchase without a journal, and
-- the journal amounts came from a tax calculation the browser threw away.
--
-- Journal (one per purchase, when it becomes 'received'):
--   key     'purchase_received:' || purchases.id with the app's PURCHASES
--           namespace b6e2f4a8-… — the same business_event_id the app uses,
--           so an old app-posted journal is never doubled
--   lines   Dr inventory_asset (1100) net   'Inventory'
--           Dr vat_input       (1200) VAT   'Recoverable tax'   (skipped if 0)
--           Cr cash            (1000) gross 'Cash / Bank'
--           tax_code null, memo
--           'Purchase confirmed: Dr Inventory / Dr Recoverable tax / Cr Cash / Bank'
--           — all exactly as the app's rule (purchase-received-posting-rule v3)
--   amounts net = purchases.subtotal, VAT = purchases.tax_total (the stored
--           totals of the purchase), gross = net + VAT (always balanced).
--           CHANGE vs the app: the app used the browser's tax result; VAT is
--           the same value (purchases.tax_total), net/gross can differ by a
--           cent with VAT-inclusive prices; the app's version could also be
--           off-balance by 0.01 and fail.
--   date    UTC calendar day of purchases.purchased_at (= the chosen day, as
--           the app). Needs an open fiscal period covering that day,
--           otherwise → posting_failures (the app needed "today's" period).
--   link    journal_entries.transaction_id = purchases.transaction_id
--   0.00 total → nothing posted, no failure.
--   failure → posting_failures (source 'purchase_receive', entity 'purchase',
--             stable business_event_id); the purchase stays received.
--
-- Also (audit finding): owner/partner could change purchases.status through
-- plain REST, e.g. received → draft → receive again = stock twice. A guard
-- trigger now refuses, for client roles (authenticated / anon):
--   * setting or changing purchases.status (only receive_purchase, which runs
--     as the function owner, may do it); a new purchase must be 'draft';
--   * changing money / date / currency / transaction of a received purchase;
--   * deleting a received purchase;
--   * inserting, changing or deleting lines of a received purchase.
-- Draft purchases stay fully editable; notes/invoice number/supplier of a
-- received purchase stay editable.
--
-- Pieces:
--   1. purchase_posting_event_id(purchase_id)
--   2. post_purchase_journals(purchase_id)   (uses sql/149's poster)
--   3. DEFERRED constraint trigger AFTER UPDATE OF status ON purchases when
--      the status becomes 'received' → at COMMIT
--   4. guard triggers on purchases / purchase_items
--
-- No backfill. Deploy order: dev → app PR (stop browser posting) → merge →
-- Vercel Ready → prod. With the old app still running its own post would come
-- back "already posted" and log a false failure row.

-- ---------------------------------------------------------------------------
-- 0. Preconditions
-- ---------------------------------------------------------------------------
DO $pre150$
BEGIN
  IF to_regprocedure('public.post_journal_by_roles_for_event(uuid, uuid, date, text, jsonb)') IS NULL
     OR to_regprocedure('public.stable_business_event_id(uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'sql/150: sql/149 is not applied';
  END IF;
  IF to_regprocedure('public.receive_purchase(uuid)') IS NULL THEN
    RAISE EXCEPTION 'sql/150: receive_purchase is missing';
  END IF;
  IF to_regprocedure('public.post_purchase_journals(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'sql/150: already applied';
  END IF;
END;
$pre150$;

-- ---------------------------------------------------------------------------
-- 1. purchase_posting_event_id
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.purchase_posting_event_id(p_purchase_id uuid)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT stable_business_event_id(
    'b6e2f4a8-7c19-5d3e-a082-4f1b9e6c3a57'::uuid,
    'purchase_received:' || p_purchase_id);
$function$;

REVOKE ALL ON FUNCTION public.purchase_posting_event_id(uuid) FROM PUBLIC, anon, authenticated;

DO $vec150$
BEGIN
  IF public.purchase_posting_event_id('00000000-0000-4000-8000-000000000001')
       <> '9c483a98-95eb-5198-906f-c92fc7da8ede'::uuid
     OR public.purchase_posting_event_id('00000000-0000-4000-8000-000000000002')
       <> 'fa1f59d4-2589-57e8-92ed-27ce40438bd1'::uuid THEN
    RAISE EXCEPTION 'sql/150: purchase_posting_event_id does not match the app''s ids';
  END IF;
END;
$vec150$;

-- ---------------------------------------------------------------------------
-- 2. post_purchase_journals
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.post_purchase_journals(p_purchase_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase purchases%ROWTYPE;
  v_net numeric;
  v_tax numeric;
BEGIN
  SELECT * INTO v_purchase FROM purchases WHERE id = p_purchase_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase % was not found.', p_purchase_id;
  END IF;
  IF v_purchase.status IS DISTINCT FROM 'received' THEN
    RAISE EXCEPTION 'Purchase % is not received.', p_purchase_id;
  END IF;

  v_net := round(COALESCE(v_purchase.subtotal, 0), 2);
  v_tax := round(COALESCE(v_purchase.tax_total, 0), 2);
  IF v_net < 0 OR v_tax < 0 THEN
    RAISE EXCEPTION 'Purchase % has a negative total (net %, VAT %).', p_purchase_id, v_net, v_tax;
  END IF;
  IF v_net + v_tax = 0 THEN
    RETURN jsonb_build_object('status', 'nothing_to_post', 'amount', 0);
  END IF;

  RETURN post_journal_by_roles_for_event(
    purchase_posting_event_id(p_purchase_id),
    v_purchase.transaction_id,
    (v_purchase.purchased_at AT TIME ZONE 'UTC')::date,
    'Purchase confirmed: Dr Inventory / Dr Recoverable tax / Cr Cash / Bank',
    jsonb_build_array(
      jsonb_build_object('role', 'inventory_asset', 'side', 'debit',
                         'amount', v_net, 'description', 'Inventory'),
      jsonb_build_object('role', 'vat_input', 'side', 'debit',
                         'amount', v_tax, 'description', 'Recoverable tax'),
      jsonb_build_object('role', 'cash', 'side', 'credit',
                         'amount', v_net + v_tax, 'description', 'Cash / Bank')));
END;
$function$;

REVOKE ALL ON FUNCTION public.post_purchase_journals(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Deferred trigger: post at commit, never undo the receive
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.purchases_auto_post_journals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM post_purchase_journals(NEW.id);
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO posting_failures (
        source_flow, entity_type, entity_id, business_event_id, error_message
      )
      VALUES (
        'purchase_receive', 'purchase', NEW.id,
        purchase_posting_event_id(NEW.id),
        'Automatic posting failed: ' || SQLERRM
      );
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.purchases_auto_post_journals() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS purchases_auto_post_journals ON public.purchases;
CREATE CONSTRAINT TRIGGER purchases_auto_post_journals
  AFTER UPDATE OF status ON public.purchases
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM 'received' AND NEW.status = 'received')
  EXECUTE FUNCTION public.purchases_auto_post_journals();

-- ---------------------------------------------------------------------------
-- 4. Guards against direct client writes (REST runs as authenticated/anon;
--    receive_purchase is SECURITY DEFINER and runs as its owner)
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.purchases_guard_client_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'A new purchase must be a draft. Use Receive to receive it.';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'received' THEN
      RAISE EXCEPTION 'A received purchase cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'The purchase status can only change by receiving the purchase.';
  END IF;
  IF OLD.status = 'received'
     AND (NEW.subtotal IS DISTINCT FROM OLD.subtotal
          OR NEW.tax_total IS DISTINCT FROM OLD.tax_total
          OR NEW.total IS DISTINCT FROM OLD.total
          OR NEW.purchased_at IS DISTINCT FROM OLD.purchased_at
          OR NEW.currency IS DISTINCT FROM OLD.currency
          OR NEW.transaction_id IS DISTINCT FROM OLD.transaction_id
          OR NEW.id IS DISTINCT FROM OLD.id) THEN
    RAISE EXCEPTION 'A received purchase cannot be changed.';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.purchases_guard_client_writes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS purchases_guard_client_writes ON public.purchases;
CREATE TRIGGER purchases_guard_client_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.purchases_guard_client_writes();

CREATE FUNCTION public.purchase_items_guard_client_writes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE')
     AND EXISTS (SELECT 1 FROM purchases WHERE id = OLD.purchase_id AND status = 'received') THEN
    RAISE EXCEPTION 'Lines of a received purchase cannot be changed.';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE')
     AND EXISTS (SELECT 1 FROM purchases WHERE id = NEW.purchase_id AND status = 'received') THEN
    RAISE EXCEPTION 'Lines of a received purchase cannot be changed.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

REVOKE ALL ON FUNCTION public.purchase_items_guard_client_writes() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS purchase_items_guard_client_writes ON public.purchase_items;
CREATE TRIGGER purchase_items_guard_client_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.purchase_items
  FOR EACH ROW
  EXECUTE FUNCTION public.purchase_items_guard_client_writes();
