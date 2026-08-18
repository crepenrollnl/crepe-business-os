-- Profiles & Role Guard Foundation
-- Introduces a real link between Supabase Auth users and application
-- roles (owner / partner / seller). Pure infrastructure — no existing
-- RPC calls require_role() yet; this migration does not change any
-- current behavior.
--
-- Does NOT:
--   - modify any existing table, RPC, or GRANT/REVOKE
--   - restrict any existing operation
--   - seed any real user's role (done manually by the business owner
--     after this migration is applied, via Supabase SQL Editor, on both
--     databases)

CREATE TABLE IF NOT EXISTS profiles (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profiles_role_check CHECK (role IN ('owner', 'partner', 'seller'))
);

COMMENT ON TABLE profiles IS
  'One row per Supabase Auth user. Single role per person (owner/partner/seller). Written only via future admin RPCs, not directly by clients.';

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own ON profiles
  FOR SELECT
  USING (auth_user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy for authenticated: profile rows are
-- written only by the seed step below (run directly by the business
-- owner as postgres role in SQL Editor) and, in a future migration, by
-- an owner-only RPC. This is intentional — do not add a write policy.

-- get_my_role(): returns the calling user's role, or NULL if they have
-- no active profile row.
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM profiles
  WHERE auth_user_id = auth.uid()
    AND is_active = true;
$$;

COMMENT ON FUNCTION get_my_role() IS
  'Returns the role (owner/partner/seller) of the currently authenticated user, or NULL if they have no active profile.';

REVOKE ALL ON FUNCTION get_my_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION get_my_role() FROM anon;
GRANT EXECUTE ON FUNCTION get_my_role() TO authenticated;

-- require_role(): raises a permission-denied-style exception unless the
-- calling user's role is one of the allowed roles. Intended to be called
-- as the first statement inside future RPCs that need role restriction,
-- e.g.: PERFORM require_role('owner', 'partner');
CREATE OR REPLACE FUNCTION require_role(VARIADIC p_allowed_roles text[])
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := get_my_role();
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'No active profile/role found for the current user.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT (v_role = ANY (p_allowed_roles)) THEN
    RAISE EXCEPTION 'Insufficient permissions for this action (role: %).', v_role
      USING ERRCODE = '42501';
  END IF;
END;
$$;

COMMENT ON FUNCTION require_role(text[]) IS
  'Call as PERFORM require_role(''owner'', ''partner'') at the top of an RPC to restrict it to specific roles. Raises 42501 if the caller''s role is missing or not allowed.';

REVOKE ALL ON FUNCTION require_role(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION require_role(text[]) FROM anon;
GRANT EXECUTE ON FUNCTION require_role(text[]) TO authenticated;
