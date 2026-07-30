-- Accounting Posting Number Sequence (V1 plan 1.1)
-- Run in Supabase SQL editor after sql/058_accounting_journal_posting_number.sql.
--
-- Fixes a race condition in posting-service.ts: posting_number was previously
-- allocated in JS by scanning existing rows and computing max+1, which is not
-- safe under concurrent postings (can produce duplicate or skipped numbers).
--
-- Additive only:
--   table:    journal_posting_sequences (internal counter, one row per fiscal year)
--   function: allocate_posting_number(p_entry_date date) -> text
--
-- Does NOT:
--   - change journal_entries / journal_lines / ledger_entries schema
--   - change any posting logic other than posting_number allocation
--   - create UI, hooks, or services

CREATE TABLE IF NOT EXISTS journal_posting_sequences (
  fiscal_year integer PRIMARY KEY,
  next_seq integer NOT NULL DEFAULT 1
);

ALTER TABLE journal_posting_sequences ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: this table is internal state for
-- allocate_posting_number() (SECURITY DEFINER) only. No direct client
-- read/write access is granted.

CREATE OR REPLACE FUNCTION allocate_posting_number(p_entry_date date)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year integer := EXTRACT(YEAR FROM p_entry_date)::integer;
  v_seq integer;
BEGIN
  INSERT INTO journal_posting_sequences (fiscal_year, next_seq)
  VALUES (v_year, 1)
  ON CONFLICT (fiscal_year) DO NOTHING;

  UPDATE journal_posting_sequences
  SET next_seq = next_seq + 1
  WHERE fiscal_year = v_year
  RETURNING next_seq - 1 INTO v_seq;

  RETURN 'JE-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION allocate_posting_number(date) TO authenticated;
