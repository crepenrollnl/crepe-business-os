-- Enable Missing RLS (V1 Phase 3 pre-flight check)
-- Run in Supabase SQL editor after sql/031_export_jobs.sql.
--
-- Problem: users, roles, user_roles, company_settings, backup_history,
-- import_jobs, and export_jobs were created (sql/026, 028, 029, 030, 031)
-- without ENABLE ROW LEVEL SECURITY, unlike every other table in the
-- project. Supabase auto-exposes every public-schema table via its REST
-- API regardless of whether the app queries it directly, so these 7 tables
-- were reachable without RLS.
--
-- No policies are added here: every write/read on these tables already
-- goes exclusively through SECURITY DEFINER RPCs (create_user, update_user,
-- deactivate_user, create_role, assign_role, update_company_settings,
-- create_backup_record, complete_backup_record, list_backups,
-- create_import_job, update_import_job_progress, complete_import_job,
-- list_import_jobs, create_export_job, update_export_job_progress,
-- complete_export_job, list_export_jobs), which run with the function
-- owner's privileges and bypass RLS entirely. Enabling RLS with no
-- policies simply closes direct REST access to these tables without
-- affecting any existing functionality.
--
-- Additive only:
--   ALTER TABLE ... ENABLE ROW LEVEL SECURITY for the 7 tables above
--
-- Does NOT:
--   - add any CREATE POLICY
--   - change any table schema, function, or other RLS-enabled table

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE backup_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;
