-- sql/151 — one-off: post the journals of received purchases that never got
-- one (audit D2 follow-up). On PROD these are 39 real purchases from
-- 14.08–12.09.2026, received before the app posted purchases at all.
--
-- Each one is posted exactly as sql/150 posts a new receive:
-- post_purchase_journals(id) → Dr 1100 net / Dr 1200 VAT / Cr 1000 gross,
-- entry date = the purchase day, stable business_event_id (so running this
-- again, or the future "Post again" button, can never double it).
--
-- All or nothing: if any purchase cannot be posted (no open period, missing
-- account, …) the whole migration stops and nothing is posted.
-- Safety stop: if ANY purchase journal exists under an id that is not a
-- purchase's stable id (= posted some older way), this migration refuses —
-- those purchases might already be in the books.
-- Skipped on purpose: a purchase that was ALREADY booked as an Expense on the
-- same day with the same VAT and the same gross (on PROD: 09.09 67.99 and
-- 11.09 18.54). Posting those again would double the cost and the VAT.
-- On an empty database (CI replay) it does nothing.

DO $bf151$
DECLARE
  v_purchase record;
  v_result jsonb;
  v_posted integer := 0;
  v_skipped integer := 0;
  v_foreign integer;
BEGIN
  IF to_regprocedure('public.post_purchase_journals(uuid)') IS NULL THEN
    RAISE EXCEPTION 'sql/151: sql/150 is not applied';
  END IF;

  SELECT count(*) INTO v_foreign
  FROM journal_entries e
  WHERE e.memo LIKE 'Purchase%'
    AND NOT EXISTS (SELECT 1 FROM purchases p
                    WHERE public.purchase_posting_event_id(p.id) = e.business_event_id);
  IF v_foreign > 0 THEN
    RAISE EXCEPTION 'sql/151: % purchase journal(s) exist under a non-standard id — stop and review', v_foreign;
  END IF;

  FOR v_purchase IN
    SELECT p.id
    FROM purchases p
    WHERE p.status = 'received'
      AND NOT EXISTS (SELECT 1 FROM journal_entries e
                      WHERE e.business_event_id = public.purchase_posting_event_id(p.id))
      AND NOT EXISTS (
            -- the same purchase was already booked as an Expense that day
            -- (same VAT, same gross) → posting it again would double it
            SELECT 1
            FROM journal_entries x
            WHERE x.status = 'posted'
              AND x.memo LIKE 'Expense:%'
              AND x.entry_date = (p.purchased_at AT TIME ZONE 'UTC')::date
              AND (SELECT COALESCE(sum(l.debit_base), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                   WHERE l.journal_entry_id = x.id AND a.code = '1200') = round(p.tax_total, 2)
              AND (SELECT COALESCE(sum(l.credit_base), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
                   WHERE l.journal_entry_id = x.id AND a.code IN ('1000', '2000'))
                  = round(p.subtotal, 2) + round(p.tax_total, 2))
    ORDER BY p.purchased_at, p.created_at, p.id
  LOOP
    v_result := public.post_purchase_journals(v_purchase.id);
    IF v_result ->> 'status' = 'nothing_to_post' THEN
      v_skipped := v_skipped + 1;
    ELSIF v_result -> 'results' -> 0 ->> 'status' = 'posted_now' THEN
      v_posted := v_posted + 1;
    ELSE
      RAISE EXCEPTION 'sql/151: unexpected result for purchase %: %', v_purchase.id, v_result;
    END IF;
  END LOOP;

  RAISE NOTICE 'sql/151: % purchase journal(s) posted, % with 0.00 totals skipped.', v_posted, v_skipped;
END;
$bf151$;
