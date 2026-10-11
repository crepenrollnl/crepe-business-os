-- Close direct client writes on sales (audit S1, step 2b of 2).
-- Run in the Supabase SQL editor after sql/139_sales_kitchen_queue_rpcs.sql,
-- and on prod ONLY AFTER the app version that calls mark_sale_queued /
-- mark_sale_fulfilled is live (otherwise "Send to queue" and "Done" in the
-- kitchen queue stop working until it is).
-- Apply on both databases (dev + prod). Idempotent. No BEGIN/COMMIT here.
--
-- Same pattern as sql/138: the open policy sales_authenticated_all
-- (FOR ALL TO authenticated USING (true) WITH CHECK (true), sql/013) is
-- replaced by sales_authenticated_select (FOR SELECT), and authenticated
-- keeps only the SELECT privilege; PUBLIC and anon get nothing.
--
-- After this, every write to sales goes through SECURITY DEFINER RPCs:
-- create_draft_sale, add/update/delete_sale_line (via sale_lines),
-- confirm_sale, create_and_confirm_sale, apply_sale_header_discount,
-- recalculate_sale_commercial_totals, set_sale_paid_flag,
-- mark_sale_queued, mark_sale_fulfilled.
-- SELECT stays open: POS, kitchen queue, sale detail, shift close and the
-- security_invoker views read sales.
--
-- The trigger sales_set_fulfilled_at_on_confirm (sql/104, SECURITY INVOKER)
-- only edits NEW inside confirm_sale's UPDATE, which runs as the table
-- owner, so it is unaffected.

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_authenticated_all ON public.sales;
DROP POLICY IF EXISTS sales_authenticated_select ON public.sales;
CREATE POLICY sales_authenticated_select ON public.sales
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON TABLE public.sales FROM PUBLIC;
REVOKE ALL ON TABLE public.sales FROM anon;
REVOKE ALL ON TABLE public.sales FROM authenticated;
GRANT SELECT ON TABLE public.sales TO authenticated;
