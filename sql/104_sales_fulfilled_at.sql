-- Kitchen queue flag on sales — fulfilled_at + default-ready trigger
-- Run in Supabase SQL editor after sql/103_recipe_photos.sql
-- (this script does not depend on recipe photos; numbering is sequential).
-- Apply on both databases (dev + prod), as with every previous sql/*.sql.
--
-- Phase 5.x of the project plan. Additive and safe to re-run
-- (IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
--
-- Does NOT:
--   - change confirm_sale / create_and_confirm_sale (money-critical RPCs)
--   - change sale_lines
--   - add TypeScript, UI, or Realtime
--
-- Semantics:
--   fulfilled_at IS NULL on a confirmed/paid sale  →  in the kitchen queue
--   fulfilled_at IS NOT NULL                       →  ready / done
-- Default after confirm is "ready": a BEFORE UPDATE OF status trigger stamps
-- now() when draft → confirmed and the client has not already set the column.
-- The Quick Sale / POS client then NULLs it only if "Send to queue" was ticked.

-- ---------------------------------------------------------------------------
-- 1. sales.fulfilled_at
-- ---------------------------------------------------------------------------

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz;

COMMENT ON COLUMN sales.fulfilled_at IS
  'NULL = заказ в очереди на кухне (или ещё не определён дефолтным триггером); значение = когда заказ стал ''готов''. По умолчанию проставляется триггером сразу при confirm; клиент явно обнуляет его, только если продавец поставил галочку ''в очередь''.';

-- ---------------------------------------------------------------------------
-- 2. One-shot backfill of rows that existed before this column
--
-- Literal `UPDATE ... WHERE fulfilled_at IS NULL` on every re-run would
-- also stamp currently queued orders (confirmed + fulfilled_at NULL by
-- design) as ready and empty the kitchen queue. Guard: run the backfill
-- only before the trigger exists, i.e. the first apply of this file,
-- when the queue feature is not live yet.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'sales_set_fulfilled_at_on_confirm'
      AND tgrelid = 'sales'::regclass
  ) THEN
    UPDATE sales
    SET fulfilled_at = confirmed_at
    WHERE confirmed_at IS NOT NULL
      AND fulfilled_at IS NULL;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Default-ready trigger on draft → confirmed
--
-- confirm_sale (sql/089) is the only writer that sets status = 'confirmed'.
-- It does:
--   UPDATE sales SET status = 'confirmed', confirmed_at = v_now, updated_at = v_now
-- and never mentions fulfilled_at. This BEFORE UPDATE OF status trigger
-- therefore fires on that statement, sees NEW.fulfilled_at still NULL, and
-- stamps now() — without touching the RPC body.
--
-- WHEN is pinned to OLD.status = 'draft' AND NEW.status = 'confirmed'
-- because that is the only status transition the project actually performs.
-- 'paid' is in the CHECK constraint and in read filters as future-proofing;
-- nothing in sql/ or TypeScript currently sets status to 'paid'. A later
-- paid-transition must not re-stamp fulfilled_at (a queued ticket that
-- somehow became paid should stay queued until the cook presses Done).
--
-- Client markSaleQueued (SET fulfilled_at = NULL) and markSaleFulfilled
-- (SET fulfilled_at = now()) do not change status, so they do not fire
-- this trigger.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_sale_fulfilled_at_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.fulfilled_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_set_fulfilled_at_on_confirm ON sales;

CREATE TRIGGER sales_set_fulfilled_at_on_confirm
  BEFORE UPDATE OF status ON sales
  FOR EACH ROW
  WHEN (
    OLD.status = 'draft'
    AND NEW.status = 'confirmed'
    AND NEW.fulfilled_at IS NULL
  )
  EXECUTE FUNCTION set_sale_fulfilled_at_on_confirm();

-- ---------------------------------------------------------------------------
-- 4. Read views — sql/015 shape plus s.fulfilled_at
--
-- CREATE OR REPLACE VIEW can drop reloptions; restore security_invoker
-- as set by sql/074 so RLS on sales/sale_lines is not bypassed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW sales_list_view AS
SELECT
  s.id AS sale_id,
  s.sale_number,
  s.status,
  s.sale_date,
  s.customer_id,
  s.subtotal,
  s.tax_total,
  s.total,
  s.confirmed_at,
  s.paid_at,
  s.cancelled_at,
  s.fulfilled_at
FROM sales s;

COMMENT ON VIEW sales_list_view IS
  'Read-only Sales list. One row per sale. No lines, FIFO, ledger, or COGS.';

GRANT SELECT ON sales_list_view TO authenticated;
ALTER VIEW sales_list_view SET (security_invoker = true);

CREATE OR REPLACE VIEW sale_details_view AS
SELECT
  s.id AS sale_id,
  s.sale_number,
  s.status,
  s.sale_date,
  s.customer_id,
  s.subtotal,
  s.tax_total,
  s.total,
  s.confirmed_at,
  s.paid_at,
  s.cancelled_at,
  sl.id AS line_id,
  sl.product_id,
  sl.quantity,
  sl.unit_price,
  sl.line_total,
  s.fulfilled_at
FROM sales s
LEFT JOIN sale_lines sl
  ON sl.sale_id = s.id;

COMMENT ON VIEW sale_details_view IS
  'Read-only Sale details. Header + lines per row. No FIFO, ledger, or COGS.';

GRANT SELECT ON sale_details_view TO authenticated;
ALTER VIEW sale_details_view SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 5. Partial index for the kitchen-queue read
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_sales_queue
  ON sales (confirmed_at)
  WHERE fulfilled_at IS NULL AND status IN ('confirmed', 'paid');
