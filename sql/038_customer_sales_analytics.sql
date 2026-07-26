-- Customer Sales Analytics Foundation (DEV-061)
-- Run in Supabase SQL editor after:
--   sql/013_create_sales.sql
--   sql/018_create_customers.sql
--
-- Read-only customer sales analytics projection + get RPCs:
--   customer_sales_analytics
--   get_customer_sales_analytics()
--   get_customer_sales_analytics_by_customer(customer_id)
--
-- Reuses confirmed / paid sales totals and customer master names.
-- No writes, no ledger updates, no inventory mutation.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     System Health / Application Information / Recipe Cost Analysis /
--     Inventory Valuation / Purchase Price History / Supplier Performance
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- customer_sales_analytics (read-only view - one row per customer)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW customer_sales_analytics AS
WITH confirmed_sales AS (
  SELECT
    s.customer_id,
    COUNT(*)::integer AS sale_count,
    COALESCE(SUM(s.total), 0) AS total_revenue,
    MAX(s.confirmed_at) AS last_sale_date
  FROM sales s
  WHERE s.status IN ('confirmed', 'paid')
    AND s.customer_id IS NOT NULL
  GROUP BY s.customer_id
)
SELECT
  c.id AS customer_id,
  c.name AS customer_name,
  COALESCE(cs.sale_count, 0)::integer AS sale_count,
  COALESCE(cs.total_revenue, 0)::numeric(14, 2) AS total_revenue,
  CASE
    WHEN COALESCE(cs.sale_count, 0) > 0 THEN
      (COALESCE(cs.total_revenue, 0) / cs.sale_count)::numeric(14, 2)
    ELSE 0::numeric(14, 2)
  END AS average_sale_value,
  cs.last_sale_date
FROM customers c
LEFT JOIN confirmed_sales cs
  ON cs.customer_id = c.id;

COMMENT ON VIEW customer_sales_analytics IS
  'Read-only customer sales analytics. Aggregates confirmed/paid sales (count, revenue, ASV, last sale). No writes or stock mutation.';

GRANT SELECT ON customer_sales_analytics TO authenticated;

-- ---------------------------------------------------------------------------
-- get_customer_sales_analytics
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_customer_sales_analytics()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'customer_id', a.customer_id,
        'customer_name', a.customer_name,
        'sale_count', a.sale_count,
        'total_revenue', a.total_revenue,
        'average_sale_value', a.average_sale_value,
        'last_sale_date', a.last_sale_date
      )
      ORDER BY a.customer_name ASC, a.customer_id ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM customer_sales_analytics a;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_customer_sales_analytics() IS
  'Return all customer sales analytics rows as JSON. Read-only aggregation over confirmed/paid sales.';

GRANT EXECUTE ON FUNCTION get_customer_sales_analytics() TO authenticated;

-- ---------------------------------------------------------------------------
-- get_customer_sales_analytics_by_customer
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_customer_sales_analytics_by_customer(
  p_customer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer id is required.';
  END IF;

  SELECT jsonb_build_object(
    'customer_id', a.customer_id,
    'customer_name', a.customer_name,
    'sale_count', a.sale_count,
    'total_revenue', a.total_revenue,
    'average_sale_value', a.average_sale_value,
    'last_sale_date', a.last_sale_date
  )
  INTO v_result
  FROM customer_sales_analytics a
  WHERE a.customer_id = p_customer_id;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_customer_sales_analytics_by_customer(uuid) IS
  'Return one customer sales analytics row as JSON. Returns null when the customer is not found.';

GRANT EXECUTE ON FUNCTION get_customer_sales_analytics_by_customer(uuid) TO authenticated;
