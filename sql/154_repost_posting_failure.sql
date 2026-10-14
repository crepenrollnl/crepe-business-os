-- sql/154 — audit D2, last step: "Post again" for a posting failure.
--
-- repost_posting_failure(failure_id) — owner/partner only. Takes one open row
-- of posting_failures, runs the database poster of its flow again, and when
-- that succeeds closes the row AND every other open row of the same
-- operation (repeated failures, the parts of one dish write-off).
--
--   source_flow                               poster (sql/147–150)
--   sale_confirm / quick_sale_confirm /
--     pos_confirm                (sale)      post_sale_journals(entity_id)
--   write_off_record          (write_off)    post_write_off_journals(entity_id)
--   production_complete (production_session) post_production_journals(entity_id)
--   purchase_receive           (purchase)    post_purchase_journals(entity_id)
--
-- The journal id is always RECOMPUTED from the operation (the stored
-- business_event_id is empty on old "skipped" rows and random on old app
-- write-off rows). Posters are idempotent: an existing journal comes back
-- "already posted", so pressing the button twice never doubles anything.
--
-- Refused (row stays open, message explains):
--   * write-off failures written by the old app (before sql/148): their
--     journal used a random id, the database cannot tell whether it exists —
--     check by hand and use "Mark resolved";
--   * unknown flow / entity type;
--   * the poster fails again (closed period, missing account, operation in a
--     wrong state …) — the message is returned, nothing is posted.
-- Result: {status: 'posted' | 'nothing_to_post', resolved: <rows closed>}.
--
-- Not here: closing record_posting_failure (sql/119) to clients — the app no
-- longer calls it, but tests 144/145 assert its grant; done in the clean-up PR.

DO $pre154$
BEGIN
  IF to_regprocedure('public.post_purchase_journals(uuid)') IS NULL
     OR to_regprocedure('public.post_production_journals(uuid)') IS NULL
     OR to_regprocedure('public.post_write_off_journals(uuid)') IS NULL
     OR to_regprocedure('public.post_sale_journals(uuid)') IS NULL THEN
    RAISE EXCEPTION 'sql/154: sql/147–150 are not all applied';
  END IF;
  IF to_regprocedure('public.repost_posting_failure(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'sql/154: already applied';
  END IF;
END;
$pre154$;

CREATE FUNCTION public.repost_posting_failure(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row posting_failures%ROWTYPE;
  v_event uuid;
  v_result jsonb;
  v_r jsonb;
  v_outcome text;
  v_closed integer;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'Posting failure id is required.';
  END IF;

  SELECT * INTO v_row FROM posting_failures WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Posting failure % was not found.', p_id;
  END IF;
  IF v_row.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'This posting failure is already resolved.';
  END IF;

  IF v_row.source_flow IN ('sale_confirm', 'quick_sale_confirm', 'pos_confirm')
     AND v_row.entity_type = 'sale' THEN
    v_event := stable_business_event_id('sale_completed:' || v_row.entity_id);
  ELSIF v_row.source_flow = 'write_off_record' AND v_row.entity_type = 'write_off' THEN
    v_event := stable_business_event_id(
      COALESCE(write_off_posting_key(v_row.entity_id), 'waste_recognized:' || v_row.entity_id));
    IF v_row.business_event_id IS DISTINCT FROM v_event THEN
      RAISE EXCEPTION 'This write-off failure was recorded before automatic posting. Check its journal by hand and use Mark resolved.';
    END IF;
  ELSIF v_row.source_flow = 'production_complete' AND v_row.entity_type = 'production_session' THEN
    v_event := production_posting_event_id(v_row.entity_id);
  ELSIF v_row.source_flow = 'purchase_receive' AND v_row.entity_type = 'purchase' THEN
    v_event := purchase_posting_event_id(v_row.entity_id);
  ELSE
    RAISE EXCEPTION 'Posting failures of type %/% cannot be posted again automatically.',
      v_row.source_flow, v_row.entity_type;
  END IF;

  BEGIN
    v_result := CASE
      WHEN v_row.source_flow = 'write_off_record' THEN post_write_off_journals(v_row.entity_id)
      WHEN v_row.source_flow = 'production_complete' THEN post_production_journals(v_row.entity_id)
      WHEN v_row.source_flow = 'purchase_receive' THEN post_purchase_journals(v_row.entity_id)
      ELSE post_sale_journals(v_row.entity_id)
    END;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'Posting again failed: %', SQLERRM;
  END;

  IF v_result ->> 'status' = 'nothing_to_post' THEN
    v_outcome := 'nothing_to_post';
  ELSIF v_result ->> 'status' = 'done' THEN
    FOR v_r IN SELECT * FROM jsonb_array_elements(v_result -> 'results')
    LOOP
      IF v_r ->> 'status' NOT IN ('posted_now', 'already_posted') THEN
        RAISE EXCEPTION 'Posting again failed: unexpected result %.', v_r;
      END IF;
    END LOOP;
    v_outcome := 'posted';
  ELSE
    -- e.g. post_sale_journals: {status: skipped, reason: sale is not confirmed}
    RAISE EXCEPTION 'Posting again failed: %.', COALESCE(v_result ->> 'reason', v_result::text);
  END IF;

  UPDATE posting_failures f
  SET resolved_at = now(),
      resolved_by = auth.uid(),
      resolution_note = CASE v_outcome
                          WHEN 'posted' THEN 'Posted again'
                          ELSE 'Nothing to post (amount 0.00)'
                        END
  WHERE f.resolved_at IS NULL
    AND (f.id = p_id
         OR (f.entity_id = v_row.entity_id AND f.entity_type = v_row.entity_type)
         OR f.business_event_id = v_event);
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  RETURN jsonb_build_object('status', v_outcome, 'resolved', v_closed);
END;
$function$;

REVOKE ALL ON FUNCTION public.repost_posting_failure(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.repost_posting_failure(uuid) TO authenticated;
