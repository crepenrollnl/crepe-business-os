-- Sales Trend Analytics Foundation (DEV-063)
-- Run in Supabase SQL editor after:
--   sql/013_create_sales.sql
--
-- Read-only sales trend analytics projection + get RPCs:
--   sales_trend_analytics
--   get_sales_trends(period_type)
--   get_sales_trend_summary()
--
-- Aggregates confirmed / paid sales into daily, weekly, and monthly periods.
-- No writes, no ledger updates, no inventory mutation.
--
-- Does NOT:
--   - mutate Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Export /
--     System Health / Application Information / Recipe Cost Analysis /
--     Inventory Valuation / Purchase Price History / Supplier Performance /
--     Customer Sales Analytics / Inventory Movement History
--   - update stock, FIFO, or accounting ledgers
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- sales_trend_analytics (read-only view - one row per period bucket)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW sales_trend_analytics AS
WITH confirmed_sales AS (
  SELECT
    s.confirmed_at,
    s.total
  FROM sales s
  WHERE s.status IN ('confirmed', 'paid')
    AND s.confirmed_at IS NOT NULL
),
daily AS (
  SELECT
    date_trunc('day', cs.confirmed_at) AS period_start,
    'daily'::text AS period_type,
    COUNT(*)::integer AS sale_count,
    COALESCE(SUM(cs.total), 0)::numeric(14, 2) AS total_revenue
  FROM confirmed_sales cs
  GROUP BY date_trunc('day', cs.confirmed_at)
),
weekly AS (
  SELECT
    date_trunc('week', cs.confirmed_at) AS period_start,
    'weekly'::text AS period_type,
    COUNT(*)::integer AS sale_count,
    COALESCE(SUM(cs.total), 0)::numeric(14, 2) AS total_revenue
  FROM confirmed_sales cs
  GROUP BY date_trunc('week', cs.confirmed_at)
),
monthly AS (
  SELECT
    date_trunc('month', cs.confirmed_at) AS period_start,
    'monthly'::text AS period_type,
    COUNT(*)::integer AS sale_count,
    COALESCE(SUM(cs.total), 0)::numeric(14, 2) AS total_revenue
  FROM confirmed_sales cs
  GROUP BY date_trunc('month', cs.confirmed_at)
),
periods AS (
  SELECT * FROM daily
  UNION ALL
  SELECT * FROM weekly
  UNION ALL
  SELECT * FROM monthly
)
SELECT
  p.period_start,
  p.period_type,
  p.sale_count,
  p.total_revenue,
  CASE
    WHEN p.sale_count > 0 THEN
      (p.total_revenue / p.sale_count)::numeric(14, 2)
    ELSE 0::numeric(14, 2)
  END AS average_sale_value
FROM periods p;

COMMENT ON VIEW sales_trend_analytics IS
  'Read-only sales trend analytics. Aggregates confirmed/paid sales by daily, weekly, and monthly periods. No writes or stock mutation.';

GRANT SELECT ON sales_trend_analytics TO authenticated;

-- ---------------------------------------------------------------------------
-- get_sales_trends
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_sales_trends(
  p_period_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_type text;
  v_result jsonb;
BEGIN
  v_period_type := lower(btrim(COALESCE(p_period_type, '')));

  IF v_period_type NOT IN ('daily', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'Period type must be daily, weekly, or monthly.';
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'period_start', t.period_start,
        'period_type', t.period_type,
        'sale_count', t.sale_count,
        'total_revenue', t.total_revenue,
        'average_sale_value', t.average_sale_value
      )
      ORDER BY t.period_start DESC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM sales_trend_analytics t
  WHERE t.period_type = v_period_type;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_sales_trends(text) IS
  'Return sales trend rows for one period type (daily, weekly, monthly) as JSON. Read-only aggregation over confirmed/paid sales.';

GRANT EXECUTE ON FUNCTION get_sales_trends(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- get_sales_trend_summary
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_sales_trend_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'sale_count', COUNT(*)::integer,
    'total_revenue', COALESCE(SUM(s.total), 0)::numeric(14, 2),
    'average_sale_value', CASE
      WHEN COUNT(*) > 0 THEN
        (COALESCE(SUM(s.total), 0) / COUNT(*))::numeric(14, 2)
      ELSE 0::numeric(14, 2)
    END,
    'first_sale_at', MIN(s.confirmed_at),
    'last_sale_at', MAX(s.confirmed_at)
  )
  INTO v_result
  FROM sales s
  WHERE s.status IN ('confirmed', 'paid')
    AND s.confirmed_at IS NOT NULL;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_sales_trend_summary() IS
  'Return overall confirmed/paid sales trend summary as JSON (count, revenue, ASV, first/last sale). Read-only.';

GRANT EXECUTE ON FUNCTION get_sales_trend_summary() TO authenticated;
