-- Scratch-only: CREATE TABLE + sequence copied from sql/019 so sql/000's
-- supplier_id FK can be created. sql/019 cannot run first — it also
-- CREATE TRIGGERs ON purchases (sql/001). The later full sql/019 is a
-- no-op on this table (IF NOT EXISTS) and then installs RPCs + trigger.

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
