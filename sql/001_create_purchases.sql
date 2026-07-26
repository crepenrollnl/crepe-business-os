-- Purchases module schema
-- Run in Supabase SQL editor before using the Purchases feature.

CREATE TABLE IF NOT EXISTS purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers (id),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'received', 'cancelled')),
  invoice_number text,
  notes text,
  subtotal numeric(12, 2) NOT NULL DEFAULT 0,
  tax_total numeric(12, 2) NOT NULL DEFAULT 0,
  total numeric(12, 2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  purchased_at timestamptz NOT NULL DEFAULT now(),
  transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NOT NULL REFERENCES purchases (id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients (id),
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(12, 4) NOT NULL CHECK (unit_cost >= 0),
  line_total numeric(12, 2) NOT NULL CHECK (line_total >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS purchases_supplier_id_idx ON purchases (supplier_id);
CREATE INDEX IF NOT EXISTS purchases_status_idx ON purchases (status);
CREATE INDEX IF NOT EXISTS purchases_purchased_at_idx ON purchases (purchased_at DESC);
CREATE INDEX IF NOT EXISTS purchase_items_purchase_id_idx ON purchase_items (purchase_id);
CREATE INDEX IF NOT EXISTS purchase_items_ingredient_id_idx ON purchase_items (ingredient_id);

-- Atomic stock increase used when receiving goods.
CREATE OR REPLACE FUNCTION increment_ingredient_stock(
  p_ingredient_id uuid,
  p_quantity numeric
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Stock increase quantity must be greater than zero';
  END IF;

  UPDATE ingredients
  SET current_stock = current_stock + p_quantity
  WHERE id = p_ingredient_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found: %', p_ingredient_id;
  END IF;
END;
$$;

ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'purchases' AND policyname = 'purchases_authenticated_all'
  ) THEN
    CREATE POLICY purchases_authenticated_all
      ON purchases
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'purchase_items' AND policyname = 'purchase_items_authenticated_all'
  ) THEN
    CREATE POLICY purchase_items_authenticated_all
      ON purchase_items
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION increment_ingredient_stock(uuid, numeric) TO authenticated;
