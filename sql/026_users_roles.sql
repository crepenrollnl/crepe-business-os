-- Users & Roles Foundation (DEV-049)
-- Standalone security data model + basic CRUD RPCs.
--
-- Tables:
--   roles / users / user_roles
--
-- Seeded roles:
--   ADMINISTRATOR / MANAGER / EMPLOYEE
--
-- RPCs:
--   create_user / update_user / deactivate_user
--   create_role / assign_role
--
-- Does NOT:
--   - implement authentication, login, JWT, or permissions
--   - enable RLS
--   - modify Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- roles
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  code text NOT NULL,
  name text NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT roles_code_key UNIQUE (code),
  CONSTRAINT roles_code_not_blank CHECK (length(btrim(code)) > 0),
  CONSTRAINT roles_name_not_blank CHECK (length(btrim(name)) > 0)
);

COMMENT ON TABLE roles IS
  'Application roles foundation (Administrator / Manager / Employee). No permissions matrix yet.';

CREATE INDEX IF NOT EXISTS roles_name_idx
  ON roles (name);

CREATE INDEX IF NOT EXISTS roles_code_idx
  ON roles (code);

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  full_name text NOT NULL,
  email text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT users_full_name_not_blank CHECK (length(btrim(full_name)) > 0),
  CONSTRAINT users_email_not_blank CHECK (length(btrim(email)) > 0),
  CONSTRAINT users_email_key UNIQUE (email)
);

COMMENT ON TABLE users IS
  'Application users master (no auth/login yet). Soft-deactivated via is_active.';

CREATE INDEX IF NOT EXISTS users_full_name_idx
  ON users (full_name);

CREATE INDEX IF NOT EXISTS users_email_idx
  ON users (email);

CREATE INDEX IF NOT EXISTS users_is_active_idx
  ON users (is_active);

-- ---------------------------------------------------------------------------
-- user_roles
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_roles (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id)
);

COMMENT ON TABLE user_roles IS
  'User ↔ role assignments. Permissions enforcement is future work.';

CREATE INDEX IF NOT EXISTS user_roles_role_id_idx
  ON user_roles (role_id);

-- ---------------------------------------------------------------------------
-- Seed built-in roles
-- ---------------------------------------------------------------------------

INSERT INTO roles (code, name)
VALUES
  ('ADMINISTRATOR', 'Administrator'),
  ('MANAGER', 'Manager'),
  ('EMPLOYEE', 'Employee')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- create_user
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_user(
  p_full_name text,
  p_email text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name text;
  v_email text;
  v_user_id uuid;
  v_now timestamptz := now();
BEGIN
  v_full_name := NULLIF(btrim(COALESCE(p_full_name, '')), '');
  IF v_full_name IS NULL THEN
    RAISE EXCEPTION 'User full name is required.';
  END IF;

  v_email := NULLIF(btrim(COALESCE(p_email, '')), '');
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'User email is required.';
  END IF;

  v_email := lower(v_email);

  INSERT INTO users (
    full_name,
    email,
    is_active,
    created_at,
    updated_at
  )
  VALUES (
    v_full_name,
    v_email,
    true,
    v_now,
    v_now
  )
  RETURNING id INTO v_user_id;

  RETURN jsonb_build_object(
    'user_id', v_user_id
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A user with this email already exists.';
END;
$$;

COMMENT ON FUNCTION create_user(text, text) IS
  'Create an active application user. Email must be unique. No auth/login.';

GRANT EXECUTE ON FUNCTION create_user(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- update_user
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_user(
  p_user_id uuid,
  p_full_name text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user users%ROWTYPE;
  v_full_name text;
  v_email text;
  v_now timestamptz := now();
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required.';
  END IF;

  SELECT *
  INTO v_user
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User was not found.';
  END IF;

  IF p_full_name IS NULL THEN
    v_full_name := v_user.full_name;
  ELSE
    v_full_name := NULLIF(btrim(p_full_name), '');
    IF v_full_name IS NULL THEN
      RAISE EXCEPTION 'User full name is required.';
    END IF;
  END IF;

  IF p_email IS NULL THEN
    v_email := v_user.email;
  ELSE
    v_email := NULLIF(btrim(p_email), '');
    IF v_email IS NULL THEN
      RAISE EXCEPTION 'User email is required.';
    END IF;
    v_email := lower(v_email);
  END IF;

  UPDATE users
  SET
    full_name = v_full_name,
    email = v_email,
    updated_at = v_now
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'user_id', p_user_id
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A user with this email already exists.';
END;
$$;

COMMENT ON FUNCTION update_user(uuid, text, text) IS
  'Update user profile fields. Does not change is_active (use deactivate_user).';

GRANT EXECUTE ON FUNCTION update_user(uuid, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- deactivate_user
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deactivate_user(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user users%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required.';
  END IF;

  SELECT *
  INTO v_user
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User was not found.';
  END IF;

  IF v_user.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'user_id', p_user_id,
      'is_active', false,
      'already_inactive', true
    );
  END IF;

  UPDATE users
  SET
    is_active = false,
    updated_at = v_now
  WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'is_active', false,
    'already_inactive', false
  );
END;
$$;

COMMENT ON FUNCTION deactivate_user(uuid) IS
  'Soft-deactivate an application user. Role assignments are retained.';

GRANT EXECUTE ON FUNCTION deactivate_user(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- create_role
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_role(
  p_code text,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_name text;
  v_role_id uuid;
  v_now timestamptz := now();
BEGIN
  v_code := NULLIF(btrim(COALESCE(p_code, '')), '');
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Role code is required.';
  END IF;

  v_code := upper(v_code);

  v_name := NULLIF(btrim(COALESCE(p_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Role name is required.';
  END IF;

  INSERT INTO roles (
    code,
    name,
    created_at
  )
  VALUES (
    v_code,
    v_name,
    v_now
  )
  RETURNING id INTO v_role_id;

  RETURN jsonb_build_object(
    'role_id', v_role_id,
    'code', v_code
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'A role with this code already exists.';
END;
$$;

COMMENT ON FUNCTION create_role(text, text) IS
  'Create a role. Code is stored uppercase and must be unique.';

GRANT EXECUTE ON FUNCTION create_role(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- assign_role
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION assign_role(
  p_user_id uuid,
  p_role_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user users%ROWTYPE;
  v_role roles%ROWTYPE;
  v_now timestamptz := now();
  v_already_assigned boolean := false;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required.';
  END IF;

  IF p_role_id IS NULL THEN
    RAISE EXCEPTION 'Role id is required.';
  END IF;

  SELECT *
  INTO v_user
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User was not found.';
  END IF;

  IF v_user.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Inactive users cannot be assigned roles.';
  END IF;

  SELECT *
  INTO v_role
  FROM roles
  WHERE id = p_role_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Role was not found.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM user_roles ur
    WHERE ur.user_id = p_user_id
      AND ur.role_id = p_role_id
  ) THEN
    v_already_assigned := true;
  ELSE
    INSERT INTO user_roles (
      user_id,
      role_id,
      assigned_at
    )
    VALUES (
      p_user_id,
      p_role_id,
      v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'role_id', p_role_id,
    'role_code', v_role.code,
    'already_assigned', v_already_assigned
  );
END;
$$;

COMMENT ON FUNCTION assign_role(uuid, uuid) IS
  'Assign a role to an active user. Idempotent when already assigned.';

GRANT EXECUTE ON FUNCTION assign_role(uuid, uuid) TO authenticated;
