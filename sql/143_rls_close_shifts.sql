-- Close direct client writes on the four shift tables (audit S1, step 4b of 2).
-- Run in the Supabase SQL editor after sql/142_shift_rpcs.sql, and on prod
-- ONLY AFTER the app version that calls open_shift / close_shift /
-- reconcile_shift_cash is live (otherwise opening/closing a shift and the
-- cash count stop working until it is).
-- Apply on both databases (dev + prod). Idempotent. No BEGIN/COMMIT here.
--
-- Same pattern as sql/138 and sql/140: the open policy
-- <table>_authenticated_all (FOR ALL TO authenticated USING (true), sql/060-063)
-- becomes <table>_authenticated_select (FOR SELECT); authenticated keeps only
-- SELECT; PUBLIC and anon get nothing.
--   shifts, shift_cash_reconciliations,
--   shift_daily_sales_summaries, shift_daily_profit_summaries
-- After this, these tables are written only by SECURITY DEFINER functions:
-- open_shift, close_shift, reconcile_shift_cash (sql/142) and confirm_sale
-- (opens a shift itself when none is open). A closed shift, its summaries
-- and its cash count can no longer be edited or deleted from the app or
-- over REST by anyone.
--
-- This is the last of the 25 tables from audit S1.

DO $s1_step4$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'shifts', 'shift_cash_reconciliations',
    'shift_daily_sales_summaries', 'shift_daily_profit_summaries'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables
  LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN
      RAISE EXCEPTION 'Table public.% does not exist. Nothing changed.', v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY v_tables
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_authenticated_all', v_table);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', v_table || '_authenticated_select', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      v_table || '_authenticated_select', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', v_table);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', v_table);
  END LOOP;

  RAISE NOTICE 'sql/143: shift tables are read-only for signed-in users; writes only through open_shift / close_shift / reconcile_shift_cash / confirm_sale.';
END;
$s1_step4$;
