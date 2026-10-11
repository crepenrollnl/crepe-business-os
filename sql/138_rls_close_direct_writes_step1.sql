-- Close direct client writes on 17 tables (audit S1, step 1 of 3).
-- Run in the Supabase SQL editor after sql/137_fiscal_period_fy2027.sql.
-- Apply on both databases (dev + prod). Idempotent. No BEGIN/COMMIT here.
--
-- Since sql/003-sql/115 these tables have the policy
--   <table>_authenticated_all  FOR ALL TO authenticated USING (true) WITH CHECK (true)
-- and Supabase gives authenticated full table privileges by default, so any
-- signed-in user (a seller too) can INSERT/UPDATE/DELETE them directly over
-- REST, bypassing every RPC guard: rewrite a sale line, delete FIFO
-- consumptions, change a batch unit_cost, change a VAT rate.
--
-- Investigation (Claude Code, 2026-10-11, full replay of sql/ + grep of src/):
-- none of these 17 tables is written by the app directly, and every SQL
-- function that writes them is SECURITY DEFINER (runs as the table owner,
-- which RLS and table privileges do not restrict). So closing direct writes
-- changes nothing the app does.
--
-- What it does, per table:
--   15 tables the app reads:
--     currencies, currency_rates, tax_categories, tax_definitions,
--     tax_jurisdictions, tax_rates, tax_rules, tax_types,
--     transactions, stock_movements, production_batches,
--     finished_goods_batch_consumptions, write_offs, sale_lines, customers
--     - drop <table>_authenticated_all
--     - add  <table>_authenticated_select  FOR SELECT TO authenticated USING (true)
--     - privileges: authenticated = SELECT only; PUBLIC and anon = nothing
--   2 unused legacy tables (sql/003, no reader or writer anywhere):
--     production_orders, production_items
--     - drop the open policy, no new policy; no privileges for authenticated/anon
--
-- SELECT stays open for authenticated on purpose: POS, kitchen queue, shift
-- close, sale detail and the security_invoker views read these tables, and
-- calculate_purchase_taxes (SECURITY INVOKER) reads the tax tables.
--
-- Does NOT (later steps):
--   - sales, shifts, shift_cash_reconciliations, shift_daily_sales_summaries,
--     shift_daily_profit_summaries, recipes, recipe_items, recipe_components
--     (the app writes them directly; they need RPCs first)
--   - role checks inside sale/customer/FIFO RPCs (audit S3)
--   - immutability triggers on ledger tables

DO $s1_step1$
DECLARE
  v_table text;
  v_read_tables text[] := ARRAY[
    'currencies', 'currency_rates',
    'tax_categories', 'tax_definitions', 'tax_jurisdictions',
    'tax_rates', 'tax_rules', 'tax_types',
    'transactions', 'stock_movements', 'production_batches',
    'finished_goods_batch_consumptions', 'write_offs',
    'sale_lines', 'customers'
  ];
  v_legacy_tables text[] := ARRAY['production_orders', 'production_items'];
BEGIN
  FOREACH v_table IN ARRAY v_read_tables || v_legacy_tables
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'Table public.% does not exist. Nothing changed.', v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY v_read_tables
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_authenticated_all', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_authenticated_select', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      v_table || '_authenticated_select', v_table
    );
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', v_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table);
  END LOOP;

  FOREACH v_table IN ARRAY v_legacy_tables
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_authenticated_all', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', v_table);
  END LOOP;

  RAISE NOTICE 'sql/138: direct writes closed on % tables (% read-only, % fully closed).',
    cardinality(v_read_tables) + cardinality(v_legacy_tables),
    cardinality(v_read_tables), cardinality(v_legacy_tables);
END;
$s1_step1$;
