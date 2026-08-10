-- Supplier Management (DEV-040)
-- Run in Supabase SQL editor after sql/001_create_purchases.sql
-- (and sql/004_create_production_plans.sql if applied — supplier_id is nullable).
--
-- Elevates suppliers to a first-class master (Customer conventions):
--   create_supplier / update_supplier / deactivate_supplier
--
-- Existing Inventory/Purchases suppliers rows are preserved.
-- New / changed purchase supplier_id values must reference an active supplier.
-- NULL supplier_id (guest) remains allowed. Historical purchases keep
-- supplier_id after deactivation.
--
-- Does NOT:
--   - modify Inventory / Production / Finished Goods / Sales / Customers app code
--   - mutate FIFO / ledger
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- suppliers (create if missing; extend if present)
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS suppliers_code_seq;

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  code text NOT NULL,
  name text NOT NULL,

  contact_name text,
  email text,
  phone text,
  vat_number text,
  notes text,

  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT suppliers_code_key UNIQUE (code),
  CONSTRAINT suppliers_name_not_blank CHECK (length(btrim(name)) > 0)
);

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS vat_number text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_active boolean;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS created_at timestamptz;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE suppliers
SET is_active = true
WHERE is_active IS NULL;

UPDATE suppliers
SET created_at = COALESCE(created_at, now())
WHERE created_at IS NULL;

UPDATE suppliers
SET updated_at = COALESCE(updated_at, now())
WHERE updated_at IS NULL;

-- Backfill codes for legacy rows (Inventory/Purchases master).
UPDATE suppliers
SET code = 'V-' || lpad(nextval('suppliers_code_seq')::text, 6, '0')
WHERE code IS NULL OR btrim(code) = '';

DO $$
BEGIN
  ALTER TABLE suppliers
    ALTER COLUMN code SET NOT NULL;
EXCEPTION
  WHEN others THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE suppliers
    ALTER COLUMN name SET NOT NULL;
EXCEPTION
  WHEN others THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE suppliers
    ALTER COLUMN is_active SET DEFAULT true;
  ALTER TABLE suppliers
    ALTER COLUMN is_active SET NOT NULL;
EXCEPTION
  WHEN others THEN
    NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE suppliers
    ALTER COLUMN created_at SET DEFAULT now();
  ALTER TABLE suppliers
    ALTER COLUMN updated_at SET DEFAULT now();
EXCEPTION
  WHEN others THEN
    NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'suppliers_code_key'
  ) THEN
    ALTER TABLE suppliers
      ADD CONSTRAINT suppliers_code_key UNIQUE (code);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'suppliers_name_not_blank'
  ) THEN
    ALTER TABLE suppliers
      ADD CONSTRAINT suppliers_name_not_blank
      CHECK (length(btrim(name)) > 0);
  END IF;
END $$;

COMMENT ON TABLE suppliers IS
  'Supplier master. Inactive suppliers cannot be selected on new purchases; existing purchases retain supplier_id.';

CREATE INDEX IF NOT EXISTS suppliers_name_idx
  ON suppliers (name);

CREATE INDEX IF NOT EXISTS suppliers_is_active_idx
  ON suppliers (is_active);

CREATE INDEX IF NOT EXISTS suppliers_code_idx
  ON suppliers (code);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'suppliers'
      AND policyname = 'suppliers_authenticated_all'
  ) THEN
    CREATE POLICY suppliers_authenticated_all
      ON suppliers
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- create_supplier
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_supplier(
  p_name text,
  p_contact_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_vat_number text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_contact_name text;
  v_email text;
  v_phone text;
  v_vat_number text;
  v_notes text;
  v_code text;
  v_supplier_id uuid;
  v_now timestamptz := now();
BEGIN
  v_name := NULLIF(btrim(COALESCE(p_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Supplier name is required.';
  END IF;

  v_contact_name := NULLIF(btrim(COALESCE(p_contact_name, '')), '');
  v_email := NULLIF(btrim(COALESCE(p_email, '')), '');
  v_phone := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_vat_number := NULLIF(btrim(COALESCE(p_vat_number, '')), '');
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');

  v_code := 'V-' || lpad(nextval('suppliers_code_seq')::text, 6, '0');

  INSERT INTO suppliers (
    code,
    name,
    contact_name,
    email,
    phone,
    vat_number,
    notes,
    is_active,
    created_at,
    updated_at
  )
  VALUES (
    v_code,
    v_name,
    v_contact_name,
    v_email,
    v_phone,
    v_vat_number,
    v_notes,
    true,
    v_now,
    v_now
  )
  RETURNING id INTO v_supplier_id;

  RETURN jsonb_build_object(
    'supplier_id', v_supplier_id,
    'code', v_code
  );
END;
$$;

COMMENT ON FUNCTION create_supplier(text, text, text, text, text, text) IS
  'Create an active supplier. Generates unique code automatically. Name is required.';

GRANT EXECUTE ON FUNCTION create_supplier(text, text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- update_supplier
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_supplier(
  p_supplier_id uuid,
  p_name text DEFAULT NULL,
  p_contact_name text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_vat_number text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier suppliers%ROWTYPE;
  v_name text;
  v_contact_name text;
  v_email text;
  v_phone text;
  v_vat_number text;
  v_notes text;
  v_now timestamptz := now();
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier id is required.';
  END IF;

  SELECT *
  INTO v_supplier
  FROM suppliers
  WHERE id = p_supplier_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier was not found.';
  END IF;

  -- NULL argument means "leave unchanged". Blank string clears nullable fields.
  IF p_name IS NULL THEN
    v_name := v_supplier.name;
  ELSE
    v_name := NULLIF(btrim(p_name), '');
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'Supplier name is required.';
    END IF;
  END IF;

  IF p_contact_name IS NULL THEN
    v_contact_name := v_supplier.contact_name;
  ELSE
    v_contact_name := NULLIF(btrim(p_contact_name), '');
  END IF;

  IF p_email IS NULL THEN
    v_email := v_supplier.email;
  ELSE
    v_email := NULLIF(btrim(p_email), '');
  END IF;

  IF p_phone IS NULL THEN
    v_phone := v_supplier.phone;
  ELSE
    v_phone := NULLIF(btrim(p_phone), '');
  END IF;

  IF p_vat_number IS NULL THEN
    v_vat_number := v_supplier.vat_number;
  ELSE
    v_vat_number := NULLIF(btrim(p_vat_number), '');
  END IF;

  IF p_notes IS NULL THEN
    v_notes := v_supplier.notes;
  ELSE
    v_notes := NULLIF(btrim(p_notes), '');
  END IF;

  UPDATE suppliers
  SET
    name = v_name,
    contact_name = v_contact_name,
    email = v_email,
    phone = v_phone,
    vat_number = v_vat_number,
    notes = v_notes,
    updated_at = v_now
  WHERE id = p_supplier_id;

  RETURN jsonb_build_object(
    'supplier_id', p_supplier_id
  );
END;
$$;

COMMENT ON FUNCTION update_supplier(uuid, text, text, text, text, text, text) IS
  'Update supplier profile fields. Does not change is_active (use deactivate_supplier).';

GRANT EXECUTE ON FUNCTION update_supplier(uuid, text, text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- deactivate_supplier
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deactivate_supplier(
  p_supplier_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier suppliers%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Supplier id is required.';
  END IF;

  SELECT *
  INTO v_supplier
  FROM suppliers
  WHERE id = p_supplier_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier was not found.';
  END IF;

  IF v_supplier.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'supplier_id', p_supplier_id,
      'is_active', false,
      'already_inactive', true
    );
  END IF;

  UPDATE suppliers
  SET
    is_active = false,
    updated_at = v_now
  WHERE id = p_supplier_id;

  -- Existing purchases retain supplier_id; only new/changed selection is blocked.
  RETURN jsonb_build_object(
    'supplier_id', p_supplier_id,
    'is_active', false,
    'already_inactive', false
  );
END;
$$;

COMMENT ON FUNCTION deactivate_supplier(uuid) IS
  'Soft-deactivate a supplier. Historical purchases keep supplier_id; new purchases cannot select inactive suppliers.';

GRANT EXECUTE ON FUNCTION deactivate_supplier(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Guard: purchase creation / supplier change may only attach active suppliers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_active_supplier_on_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier suppliers%ROWTYPE;
BEGIN
  -- Guest / unassigned supplier remains supported.
  IF NEW.supplier_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Historical rows keep inactive suppliers unless supplier_id changes.
  IF TG_OP = 'UPDATE'
    AND NEW.supplier_id IS NOT DISTINCT FROM OLD.supplier_id
  THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_supplier
  FROM suppliers
  WHERE id = NEW.supplier_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier was not found.';
  END IF;

  IF v_supplier.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Inactive suppliers cannot be selected for new purchases.';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION enforce_active_supplier_on_purchase() IS
  'Trigger: new or changed purchase.supplier_id must reference an active supplier. NULL guest supplier allowed.';

DROP TRIGGER IF EXISTS purchases_enforce_active_supplier ON purchases;

CREATE TRIGGER purchases_enforce_active_supplier
  BEFORE INSERT OR UPDATE OF supplier_id
  ON purchases
  FOR EACH ROW
  EXECUTE FUNCTION enforce_active_supplier_on_purchase();
