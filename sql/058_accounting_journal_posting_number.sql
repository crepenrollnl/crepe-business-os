-- Accounting Journal Posting Number (DEV-091)
-- Run in Supabase SQL editor after sql/056_accounting_journals.sql.
--
-- Additive only:
--   journal_entries.posting_number
--
-- Required so the Posting Service can assign a stable posting number
-- when converting a Journal Proposal into a posted journal.
--
-- Does NOT:
--   - create RPCs / posting engine logic
--   - modify ledger_entries
--   - create UI, hooks, or services

ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS posting_number text;

COMMENT ON COLUMN journal_entries.posting_number IS
  'Stable human posting number assigned when status becomes posted (e.g. JE-2026-000001).';

CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_posting_number_uidx
  ON journal_entries (posting_number)
  WHERE posting_number IS NOT NULL;

ALTER TABLE journal_entries
  DROP CONSTRAINT IF EXISTS journal_entries_posting_number_when_posted;

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_posting_number_when_posted
  CHECK (
    (status = 'draft' AND posting_number IS NULL)
    OR (status IN ('posted', 'voided'))
  );
