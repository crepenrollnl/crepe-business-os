-- Customer Management (DEV-039)
-- Run in Supabase SQL editor after sql/013_create_sales.sql
-- and sql/016_create_draft_sale.sql (recommended).
--
-- Creates the customers master table + RPCs:
--   create_customer / update_customer / deactivate_customer
--
-- Also tightens create_draft_sale so new drafts may only reference
-- active customers (guest sales with null customer_id remain allowed).
-- Historical sales keep their customer_id even after deactivation.
--
-- Does NOT:
--   - modify Inventory / Production / Finished Goods / FIFO / ledger
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS customers_code_seq;

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  code text NOT NULL,
  name text NOT NULL,

  email text,
  phone text,
  vat_number text,
  notes text,

  is_active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT customers_code_key UNIQUE (code),
  CONSTRAINT customers_name_not_blank CHECK (length(btrim(name)) > 0)
);

COMMENT ON TABLE customers IS
  'Customer master. Inactive customers cannot be selected on new draft sales; existing sales retain customer_id.';

CREATE INDEX IF NOT EXISTS customers_name_idx
  ON customers (name);

CREATE INDEX IF NOT EXISTS customers_is_active_idx
  ON customers (is_active);

CREATE INDEX IF NOT EXISTS customers_code_idx
  ON customers (code);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'customers'
      AND policyname = 'customers_authenticated_all'
  ) THEN
    CREATE POLICY customers_authenticated_all
      ON customers
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- Optional FK for new integrity. Existing orphan customer_id values (if any)
-- would block this; skip when orphans are present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sales'
      AND column_name = 'customer_id'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_customer_id_fkey'
  ) AND NOT EXISTS (
    SELECT 1
    FROM sales s
    WHERE s.customer_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM customers c WHERE c.id = s.customer_id
      )
  ) THEN
    ALTER TABLE sales
      ADD CONSTRAINT sales_customer_id_fkey
      FOREIGN KEY (customer_id)
      REFERENCES customers (id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- create_customer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_customer(
  p_name text,
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
  v_email text;
  v_phone text;
  v_vat_number text;
  v_notes text;
  v_code text;
  v_customer_id uuid;
  v_now timestamptz := now();
BEGIN
  v_name := NULLIF(btrim(COALESCE(p_name, '')), '');
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Customer name is required.';
  END IF;

  v_email := NULLIF(btrim(COALESCE(p_email, '')), '');
  v_phone := NULLIF(btrim(COALESCE(p_phone, '')), '');
  v_vat_number := NULLIF(btrim(COALESCE(p_vat_number, '')), '');
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');

  v_code := 'C-' || lpad(nextval('customers_code_seq')::text, 6, '0');

  INSERT INTO customers (
    code,
    name,
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
    v_email,
    v_phone,
    v_vat_number,
    v_notes,
    true,
    v_now,
    v_now
  )
  RETURNING id INTO v_customer_id;

  RETURN jsonb_build_object(
    'customer_id', v_customer_id,
    'code', v_code
  );
END;
$$;

COMMENT ON FUNCTION create_customer(text, text, text, text, text) IS
  'Create an active customer. Generates unique code automatically. Name is required.';

GRANT EXECUTE ON FUNCTION create_customer(text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- update_customer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_customer(
  p_customer_id uuid,
  p_name text DEFAULT NULL,
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
  v_customer customers%ROWTYPE;
  v_name text;
  v_email text;
  v_phone text;
  v_vat_number text;
  v_notes text;
  v_now timestamptz := now();
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer id is required.';
  END IF;

  SELECT *
  INTO v_customer
  FROM customers
  WHERE id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer was not found.';
  END IF;

  -- NULL argument means "leave unchanged". Blank string clears nullable fields.
  IF p_name IS NULL THEN
    v_name := v_customer.name;
  ELSE
    v_name := NULLIF(btrim(p_name), '');
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'Customer name is required.';
    END IF;
  END IF;

  IF p_email IS NULL THEN
    v_email := v_customer.email;
  ELSE
    v_email := NULLIF(btrim(p_email), '');
  END IF;

  IF p_phone IS NULL THEN
    v_phone := v_customer.phone;
  ELSE
    v_phone := NULLIF(btrim(p_phone), '');
  END IF;

  IF p_vat_number IS NULL THEN
    v_vat_number := v_customer.vat_number;
  ELSE
    v_vat_number := NULLIF(btrim(p_vat_number), '');
  END IF;

  IF p_notes IS NULL THEN
    v_notes := v_customer.notes;
  ELSE
    v_notes := NULLIF(btrim(p_notes), '');
  END IF;

  UPDATE customers
  SET
    name = v_name,
    email = v_email,
    phone = v_phone,
    vat_number = v_vat_number,
    notes = v_notes,
    updated_at = v_now
  WHERE id = p_customer_id;

  RETURN jsonb_build_object(
    'customer_id', p_customer_id
  );
END;
$$;

COMMENT ON FUNCTION update_customer(uuid, text, text, text, text, text) IS
  'Update customer profile fields. Does not change is_active (use deactivate_customer).';

GRANT EXECUTE ON FUNCTION update_customer(uuid, text, text, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- deactivate_customer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deactivate_customer(
  p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer customers%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer id is required.';
  END IF;

  SELECT *
  INTO v_customer
  FROM customers
  WHERE id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer was not found.';
  END IF;

  IF v_customer.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'customer_id', p_customer_id,
      'is_active', false,
      'already_inactive', true
    );
  END IF;

  UPDATE customers
  SET
    is_active = false,
    updated_at = v_now
  WHERE id = p_customer_id;

  -- Existing sales retain customer_id; only new draft selection is blocked.
  RETURN jsonb_build_object(
    'customer_id', p_customer_id,
    'is_active', false,
    'already_inactive', false
  );
END;
$$;

COMMENT ON FUNCTION deactivate_customer(uuid) IS
  'Soft-deactivate a customer. Historical sales keep customer_id; new drafts cannot select inactive customers.';

GRANT EXECUTE ON FUNCTION deactivate_customer(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Guard: create_draft_sale may only attach active customers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_draft_sale(
  p_customer_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id uuid;
  v_sale_number text;
  v_notes text;
  v_customer customers%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');

  IF p_customer_id IS NOT NULL THEN
    SELECT *
    INTO v_customer
    FROM customers
    WHERE id = p_customer_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer was not found.';
    END IF;

    IF v_customer.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Inactive customers cannot be selected for new draft sales.';
    END IF;
  END IF;

  v_sale_number := 'S-' || lpad(nextval('sales_sale_number_seq')::text, 6, '0');

  INSERT INTO sales (
    sale_number,
    customer_id,
    status,
    sale_date,
    notes,
    subtotal,
    tax_total,
    total,
    created_at,
    updated_at
  )
  VALUES (
    v_sale_number,
    p_customer_id,
    'draft',
    CURRENT_DATE,
    v_notes,
    0,
    0,
    0,
    v_now,
    v_now
  )
  RETURNING id INTO v_sale_id;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id
  );
END;
$$;

COMMENT ON FUNCTION create_draft_sale(uuid, text) IS
  'Create a draft sale header only (no lines). Guest sales allowed (null customer_id). Non-null customer_id must reference an active customer.';
