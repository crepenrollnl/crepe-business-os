-- Sales schema (DEV-026)
-- Run in Supabase SQL editor after sql/010_finished_goods_batch_consumptions.sql
-- (and Finished Goods / Production prerequisites).
--
-- Creates the Sales document tables only:
--   - sales (header)
--   - sale_lines (line items)
--
-- SCHEMA ONLY:
--   - no RPCs
--   - no triggers
--   - no views
--   - no FIFO / allocation logic
--   - no remaining_quantity
--   - no COGS columns (COGS lives on finished_goods_batch_consumptions)
--
-- Does not create allocation, payment, shipment, or accounting tables.
-- Does not modify production_batches or finished_goods_batch_consumptions.

-- ---------------------------------------------------------------------------
-- sales (header document)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  sale_number text NOT NULL,

  -- Nullable for MVP guest sales. Customers master table is future;
  -- no FK until that module exists.
  customer_id uuid,

  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'paid', 'cancelled')),

  sale_date date NOT NULL DEFAULT (CURRENT_DATE),

  confirmed_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,

  subtotal numeric(12, 2) NOT NULL DEFAULT 0
    CHECK (subtotal >= 0),
  tax_total numeric(12, 2) NOT NULL DEFAULT 0
    CHECK (tax_total >= 0),
  total numeric(12, 2) NOT NULL DEFAULT 0
    CHECK (total >= 0),

  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sales_sale_number_key UNIQUE (sale_number)
);

COMMENT ON TABLE sales IS
  'Sales header document. Stock leaves Finished Goods only on Confirm (via ledger RPC); Paid is settlement only.';

-- ---------------------------------------------------------------------------
-- sale_lines (immutable commercial lines after confirm; no FIFO / COGS here)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  sale_id uuid NOT NULL
    REFERENCES sales (id) ON DELETE CASCADE,

  -- Finished-good identity. Until Products master exists this equals
  -- production_batches.finished_good_id (= recipe_id convention).
  -- No FK: matches production_batches.finished_good_id (no products table yet).
  product_id uuid NOT NULL,

  quantity numeric(12, 3) NOT NULL
    CHECK (quantity > 0),

  unit_price numeric(12, 4) NOT NULL
    CHECK (unit_price >= 0),

  line_total numeric(12, 2) NOT NULL
    CHECK (line_total >= 0),

  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE sale_lines IS
  'Sale line items. Do not store FIFO, production_batch_id, COGS, or remaining_quantity; those belong to the Finished Goods ledger.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS sales_status_idx
  ON sales (status);

CREATE INDEX IF NOT EXISTS sales_sale_date_idx
  ON sales (sale_date DESC);

CREATE INDEX IF NOT EXISTS sales_customer_id_idx
  ON sales (customer_id);

CREATE INDEX IF NOT EXISTS sales_confirmed_at_idx
  ON sales (confirmed_at DESC);

CREATE INDEX IF NOT EXISTS sale_lines_sale_id_idx
  ON sale_lines (sale_id);

CREATE INDEX IF NOT EXISTS sale_lines_product_id_idx
  ON sale_lines (product_id);

-- ---------------------------------------------------------------------------
-- RLS (consistent with purchases / production / finished goods)
-- ---------------------------------------------------------------------------

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_lines ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'sales'
      AND policyname = 'sales_authenticated_all'
  ) THEN
    CREATE POLICY sales_authenticated_all
      ON sales
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'sale_lines'
      AND policyname = 'sale_lines_authenticated_all'
  ) THEN
    CREATE POLICY sale_lines_authenticated_all
      ON sale_lines
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
