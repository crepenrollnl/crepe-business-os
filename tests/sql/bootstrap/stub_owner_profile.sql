-- Scratch/CI seed for vanilla postgres:16 (no live Supabase Auth users).
-- Not a numbered migration. Do not apply on live Supabase.
--
-- sql/097 creates profiles but explicitly does not seed a role row.
-- sql/116–120 dry-run DO blocks look up one active owner/partner and
-- emulate auth.uid() from it. Reject-paths (sql/117, sql/119) flip that
-- same row to 'seller' inside BEGIN…ROLLBACK — they do not need a second
-- profiles row.
--
-- Applied after sql/097 and before sql/098 so the committed row survives
-- later psql invocations. FK requires a matching auth.users id (stubbed
-- in prelude_auth.sql).

INSERT INTO auth.users (id, email)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'sql-replay-stub-owner@example.invalid'
);

INSERT INTO profiles (auth_user_id, role, is_active)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'owner',
  true
);
