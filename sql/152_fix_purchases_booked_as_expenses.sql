-- sql/152 — one-off: two purchases (PROD: 09.09.2026 67.99 / VAT 5.61 and
-- 11.09.2026 18.54 / VAT 1.53) were also typed in by hand as Expenses
-- "Groceries" while purchases were not reaching accounting. Mykola confirmed
-- (14.10) they are the same receipts. The goods are in stock, so the correct
-- booking is the purchase (inventory), not an expense.
--
-- For every received purchase that has no purchase journal AND matches
-- exactly one posted "Expense:" journal on the same day with the same VAT and
-- the same gross (the rule sql/151 used to skip them):
--   1. post a REVERSAL of that expense journal: same date, every line mirrored
--      (debit ↔ credit), reversal_of_journal_entry_id = the original, memo
--      'Reversal (duplicate of purchase <id>): <original memo>'. Posted
--      journals are immutable, so the original stays and is cancelled out;
--   2. delete the expense's row in expense_entries (the list on the Expenses
--      page) — the original journal + reversal keep the full history;
--   3. post the purchase journal (post_purchase_journals, as sql/150).
-- Net effect: VAT (1200) and cash unchanged; the cost moves from the expense
-- account to inventory (1100).
--
-- All or nothing. Stops if a purchase matches more than one expense, or an
-- expense matches more than one purchase. Running it again does nothing.

DO $fx152$
DECLARE
  v_match record;
  v_lines jsonb;
  v_ledger jsonb;
  v_entry uuid;
  v_line record;
  v_line_id uuid;
  v_now timestamptz := now();
  v_result jsonb;
  v_done integer := 0;
BEGIN
  IF to_regprocedure('public.post_purchase_journals(uuid)') IS NULL THEN
    RAISE EXCEPTION 'sql/152: sql/150 is not applied';
  END IF;

  DROP TABLE IF EXISTS fx152_pairs;
  CREATE TEMP TABLE fx152_pairs ON COMMIT DROP AS
  SELECT p.id AS purchase_id, x.id AS journal_id
  FROM purchases p
  JOIN journal_entries x
    ON x.status = 'posted'
   AND x.memo LIKE 'Expense:%'
   AND x.entry_date = (p.purchased_at AT TIME ZONE 'UTC')::date
   AND (SELECT COALESCE(sum(l.debit_base), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.journal_entry_id = x.id AND a.code = '1200') = round(p.tax_total, 2)
   AND (SELECT COALESCE(sum(l.credit_base), 0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id
        WHERE l.journal_entry_id = x.id AND a.code IN ('1000', '2000'))
       = round(p.subtotal, 2) + round(p.tax_total, 2)
  WHERE p.status = 'received'
    AND p.subtotal + p.tax_total <> 0
    AND NOT EXISTS (SELECT 1 FROM journal_entries e
                    WHERE e.business_event_id = public.purchase_posting_event_id(p.id))
    AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reversal_of_journal_entry_id = x.id);

  IF EXISTS (SELECT 1 FROM fx152_pairs GROUP BY purchase_id HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM fx152_pairs GROUP BY journal_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'sql/152: ambiguous purchase ↔ expense match — stop and review';
  END IF;

  FOR v_match IN
    SELECT f.purchase_id, x.*
    FROM fx152_pairs f
    JOIN journal_entries x ON x.id = f.journal_id
    ORDER BY x.entry_date, x.id
  LOOP
    -- 1. reversal of the expense journal (mirror every line)
    v_entry := gen_random_uuid();
    v_lines := '[]'::jsonb;
    v_ledger := '[]'::jsonb;
    FOR v_line IN
      SELECT * FROM journal_lines WHERE journal_entry_id = v_match.id ORDER BY line_no
    LOOP
      v_line_id := gen_random_uuid();
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'id', v_line_id, 'journal_entry_id', v_entry, 'line_no', v_line.line_no,
        'account_id', v_line.account_id,
        'description', 'Reversal: ' || COALESCE(v_line.description, ''),
        'debit_transaction', v_line.credit_transaction, 'credit_transaction', v_line.debit_transaction,
        'debit_base', v_line.credit_base, 'credit_base', v_line.debit_base,
        'tax_code', v_line.tax_code));
      v_ledger := v_ledger || jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid(), 'journal_entry_id', v_entry, 'journal_line_id', v_line_id,
        'fiscal_period_id', v_match.fiscal_period_id, 'account_id', v_line.account_id,
        'entry_date', v_match.entry_date,
        'debit_base', v_line.credit_base, 'credit_base', v_line.debit_base,
        'debit_transaction', v_line.credit_transaction, 'credit_transaction', v_line.debit_transaction,
        'transaction_currency', v_match.transaction_currency, 'base_currency', v_match.base_currency));
    END LOOP;

    v_result := post_journal_proposals_internal(
      jsonb_build_array(jsonb_build_object(
        'journal_entry', jsonb_build_object(
          'id', v_entry,
          'business_event_id', stable_business_event_id('expense_duplicate_reversal:' || v_match.id),
          'transaction_id', NULL,
          'fiscal_period_id', v_match.fiscal_period_id,
          'entry_date', v_match.entry_date,
          'memo', 'Reversal (duplicate of purchase ' || v_match.purchase_id || '): ' || v_match.memo,
          'status', 'posted',
          'posting_number', NULL,
          'transaction_currency', v_match.transaction_currency,
          'base_currency', v_match.base_currency,
          'exchange_rate', v_match.exchange_rate,
          'reversal_of_journal_entry_id', v_match.id,
          'posted_at', v_now,
          'created_at', v_now),
        'journal_lines', v_lines,
        'ledger_entries', v_ledger)),
      v_match.entry_date, v_now);
    IF v_result -> 0 ->> 'status' IS DISTINCT FROM 'posted_now' THEN
      RAISE EXCEPTION 'sql/152: reversal of % not posted: %', v_match.id, v_result;
    END IF;

    -- 2. remove the duplicate from the Expenses list
    DELETE FROM expense_entries WHERE journal_entry_id = v_match.id;

    -- 3. post the purchase
    v_result := post_purchase_journals(v_match.purchase_id);
    IF v_result -> 'results' -> 0 ->> 'status' IS DISTINCT FROM 'posted_now' THEN
      RAISE EXCEPTION 'sql/152: purchase % not posted: %', v_match.purchase_id, v_result;
    END IF;

    v_done := v_done + 1;
  END LOOP;

  RAISE NOTICE 'sql/152: % duplicate expense(s) reversed and purchase(s) posted.', v_done;
END;
$fx152$;
