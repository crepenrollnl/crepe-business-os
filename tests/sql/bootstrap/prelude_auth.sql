-- Scratch/CI prelude for vanilla postgres:16 (no Supabase).
-- Not a numbered migration. Do not apply on live Supabase.
--
-- auth.uid() body is the live crepe-business-V1 definition quoted in
-- sql/106_empirical_zero_cost_guard_dev.sql (24.08.2026), taken from
-- pg_get_functiondef('auth.uid()') — not invented:
--   coalesce(
--     nullif(current_setting('request.jwt.claim.sub', true), ''),
--     (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
--   )::uuid

DO $$
BEGIN
  CREATE ROLE authenticated NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE ROLE anon NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE SCHEMA IF NOT EXISTS auth;

-- email: live Supabase auth.users has this column; sql/113 joins it.
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$function$;
