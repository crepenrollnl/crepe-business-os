-- sql/153 — one-off clean-up after D2 (14.10.2026). On PROD:
--   * 1 confirmed sale from 10.10.2026 has no journal (it was confirmed before
--     sql/147 made the database post sales);
--   * 1 unresolved posting failure of 09.10.2026: a write-off whose value is
--     below one cent ("Posting rule produced no journal lines…") — nothing
--     to post, the row only needs closing.
--
-- 1. Every confirmed/paid sale without its sale journal is posted with the
--    database poster post_sale_journals (sql/147): same rules, stable ids, so
--    a second run posts nothing. A sale with 0.00 subtotal has no sale
--    journal by design (only COGS, if any) — that is fine.
-- 2. Unresolved posting failures are closed when
--      a) their journal now exists (business_event_id found), or
--      b) they are write-off failures and the write-off is worth < 0.005
--         (rounds to 0.00 → nothing can ever be posted).
--    resolved_by stays empty (done by migration), resolution_note says why.
-- All or nothing. On an empty database (CI replay) it does nothing.

DO $lo153$
DECLARE
  v_sale record;
  v_result jsonb;
  v_r jsonb;
  v_posted integer := 0;
  v_closed integer := 0;
  v_n integer;
BEGIN
  IF to_regprocedure('public.post_sale_journals(uuid)') IS NULL THEN
    RAISE EXCEPTION 'sql/153: sql/147 is not applied';
  END IF;

  FOR v_sale IN
    SELECT s.id
    FROM sales s
    WHERE s.status IN ('confirmed', 'paid')
      AND s.confirmed_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM journal_entries e
                      WHERE e.business_event_id = public.stable_business_event_id('sale_completed:' || s.id))
    ORDER BY s.confirmed_at, s.id
  LOOP
    v_result := public.post_sale_journals(v_sale.id);
    IF v_result ->> 'status' = 'done' THEN
      FOR v_r IN SELECT * FROM jsonb_array_elements(v_result -> 'results')
      LOOP
        IF v_r ->> 'status' NOT IN ('posted_now', 'already_posted') THEN
          RAISE EXCEPTION 'sql/153: sale % not posted: %', v_sale.id, v_result;
        END IF;
      END LOOP;
      v_posted := v_posted + 1;
    ELSIF v_result ->> 'status' IS DISTINCT FROM 'nothing_to_post' THEN
      RAISE EXCEPTION 'sql/153: sale % unexpected result: %', v_sale.id, v_result;
    END IF;
  END LOOP;

  UPDATE posting_failures f
  SET resolved_at = now(),
      resolution_note = 'Journal exists (closed by sql/153)'
  WHERE f.resolved_at IS NULL
    AND f.business_event_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM journal_entries e
                WHERE e.business_event_id = f.business_event_id AND e.status = 'posted');
  GET DIAGNOSTICS v_closed = ROW_COUNT;

  UPDATE posting_failures f
  SET resolved_at = now(),
      resolution_note = 'Write-off below 0.01 — nothing to post (closed by sql/153)'
  WHERE f.resolved_at IS NULL
    AND f.source_flow = 'write_off_record'
    AND EXISTS (SELECT 1 FROM write_offs w
                WHERE w.id = f.entity_id AND round(COALESCE(w.total_value, 0), 2) = 0);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_closed := v_closed + v_n;

  RAISE NOTICE 'sql/153: % sale(s) posted, % posting failure(s) closed.', v_posted, v_closed;
END;
$lo153$;
