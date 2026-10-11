-- Open fiscal year FY2027 (audit O1, hard date 2027-01-01).
-- Run in the Supabase SQL editor after sql/136_record_dish_write_off.sql.
-- Apply on both databases (dev + prod). Idempotent. No BEGIN/COMMIT here.
--
-- sql/081 seeded only FY2026 and the app has no screen to open a new
-- year. post_journal_proposals (sql/117) rejects a posting whose date is
-- outside an open fiscal period, so from 2027-01-01 every sale, purchase,
-- production run and write-off would fail to post.
--
-- What it does: inserts FY2027 (2027-01-01 .. 2027-12-31, open).
--   - Already there with exactly these dates → nothing happens.
--   - Any other period overlapping 2027 → stops with an error, nothing
--     is written (a human must look at it).
-- Nothing else is needed for the new year:
--   - account_role_bindings are open-ended (effective_to NULL);
--   - tax_definitions / tax_rates / tax_rules for NL are open-ended;
--   - journal_posting_sequences creates the 2027 row on first use (sql/064).
--
-- Does NOT: close FY2026, change any existing row, add a UI.

DO $fy2027$
DECLARE
  v_existing fiscal_periods%ROWTYPE;
  v_overlap text;
BEGIN
  SELECT * INTO v_existing FROM fiscal_periods WHERE name = 'FY2027';

  IF FOUND THEN
    IF v_existing.start_date <> DATE '2027-01-01'
       OR v_existing.end_date <> DATE '2027-12-31' THEN
      RAISE EXCEPTION 'FY2027 already exists with dates % .. % — expected 2027-01-01 .. 2027-12-31. Nothing changed.',
        v_existing.start_date, v_existing.end_date;
    END IF;
    RAISE NOTICE 'FY2027 already exists (status %). Nothing changed.', v_existing.status;
    RETURN;
  END IF;

  SELECT string_agg(name || ' ' || start_date || '..' || end_date, ', ' ORDER BY start_date)
  INTO v_overlap
  FROM fiscal_periods
  WHERE start_date <= DATE '2027-12-31'
    AND end_date >= DATE '2027-01-01';

  IF v_overlap IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add FY2027: it overlaps existing period(s) %. Nothing changed.', v_overlap;
  END IF;

  INSERT INTO fiscal_periods (name, start_date, end_date, status)
  VALUES ('FY2027', DATE '2027-01-01', DATE '2027-12-31', 'open');

  RAISE NOTICE 'FY2027 added (open).';
END;
$fy2027$;
