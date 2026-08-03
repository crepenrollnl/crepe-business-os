-- Explicit table-level REVOKE for accounts / fiscal_periods
-- Run in Supabase SQL editor after sql/055_accounting_chart_of_accounts.sql
-- and sql/054_accounting_fiscal_periods.sql.
--
-- Checked: neither sql/054 nor sql/055 has ever carried an explicit
-- REVOKE ALL ... FROM PUBLIC/anon on their table. Neither did sql/074 (the
-- project-wide anon/PUBLIC revoke) -- that migration explicitly scoped
-- itself to functions and views only, stating (sql/074, lines 44-46):
-- "Does NOT: ... touch tables directly (RLS on tables already correctly
-- restricts anon -- confirmed empirically: an anonymous `select * from
-- sales` returned zero rows)." A repo-wide grep for `REVOKE ... ON TABLE`
-- across every file in sql/ turns up zero matches anywhere except
-- sql/080_account_role_bindings.sql (this session's own addition) -- every
-- other table in the project, accounts/fiscal_periods included, has always
-- relied on RLS alone (enable + authenticated-only policy, no policy for
-- anon = zero access), verified empirically and never revisited since.
--
-- This migration does not change that verified RLS behavior -- anon access
-- was already blocked. It adds the same explicit table-level REVOKE now
-- applied to account_role_bindings (sql/080) for consistency across the
-- three tables Accounting Posting depends on, per explicit request.
--
-- Does NOT:
--   - change any RLS policy, column, or constraint
--   - change anon's actual (already-zero) access to these tables

REVOKE ALL ON TABLE accounts FROM PUBLIC;
REVOKE ALL ON TABLE accounts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE accounts TO authenticated;

REVOKE ALL ON TABLE fiscal_periods FROM PUBLIC;
REVOKE ALL ON TABLE fiscal_periods FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE fiscal_periods TO authenticated;
