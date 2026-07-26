-- Create Draft Sale (DEV-034)
-- Run in Supabase SQL editor after sql/013_create_sales.sql
-- (and sql/015_sales_read_model.sql if already applied).
--
-- Atomically creates a draft Sale header only:
--   generate sale_number -> insert sales row (status = draft)
--   -> return sale_id
--
-- Does NOT:
--   - create sale_lines
--   - allocate inventory / FIFO
--   - calculate or store totals / COGS
--   - mutate Finished Goods or Production Batches
--   - create services, hooks, or UI

CREATE SEQUENCE IF NOT EXISTS sales_sale_number_seq;

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
  v_now timestamptz := now();
BEGIN
  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');

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
  'Create a draft sale header only (no lines). Generates sale_number; allows null customer_id and optional notes. No inventory, FIFO, or totals.';

GRANT EXECUTE ON FUNCTION create_draft_sale(uuid, text) TO authenticated;
