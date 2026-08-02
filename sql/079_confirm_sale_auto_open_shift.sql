-- Auto-open a shift on sale confirmation (V1 pending finding 1.13)
-- Run in Supabase SQL editor after sql/060_create_shifts.sql
-- and sql/014_confirm_sale.sql.
--
-- Problem: confirm_sale never checked for an open shift. A sale confirmed
-- while no shift is open is confirmed successfully (sales has no shift_id
-- column at all -- linkage to a shift is purely by time window, matched
-- later by daily-sales-summary-service.ts / daily-profit-summary-service.ts
-- via confirmed_at BETWEEN shift.opened_at AND shift.closed_at). Once that
-- window closes without covering the sale, the sale can never retroactively
-- join a shift_daily_sales_summaries / shift_daily_profit_summaries row --
-- those are append-only (verified immutable, sql/065/066) -- so the revenue
-- silently never appears on the dashboard, which reads only those frozen
-- summaries (see the 01.08.2026 finding for item 1.13).
--
-- Fix: confirm_sale now ensures a shift is open before confirming, in the
-- same transaction as the rest of the confirm. Pattern: lock any existing
-- open shift row first (SELECT ... WHERE status = 'open' FOR UPDATE, same
-- lock-first approach as confirm_production_plan, sql/078); only if none is
-- found does it insert a new one.
--
-- FOR UPDATE alone is NOT enough to close the race, and this is worth
-- spelling out for future readers: "SELECT ... WHERE status = 'open' FOR
-- UPDATE" only takes a lock on rows that already match the predicate. When
-- zero shifts are open there is no row to lock, so two concurrent
-- confirm_sale calls (or a concurrent confirm_sale and a manual
-- openShift() click) can both observe NOT FOUND and both attempt the
-- INSERT. The second INSERT then violates the partial unique index
-- shifts_one_open_uidx (sql/060) with a raw unique_violation, which -- if
-- left uncaught -- aborts the whole confirm_sale transaction, rolling back
-- the FIFO allocation that had already run for this call. The INSERT is
-- therefore wrapped in its own BEGIN/EXCEPTION sub-block (a PL/pgSQL
-- exception block is an implicit savepoint): on unique_violation, the
-- loser simply re-reads and locks the row the winner just inserted instead
-- of failing. This also transparently covers a race against the
-- independent openShift() TS code path (a plain INSERT with no lock of its
-- own) without requiring changes there.
--
-- Additive to confirm_sale's behavior only:
--   - no schema changes
--   - does not touch shift close, cash reconciliation, or the daily summary
--     RPCs (065/066/067) -- those still read purely by confirmed_at window
--   - does not change confirm_sale's existing validation, FIFO allocation,
--     or return shape (still { sale_id, total_cogs })
--   - does not add a shift_id column to sales -- linkage stays time-window
--     based, as already documented in sql/013

CREATE OR REPLACE FUNCTION confirm_sale(
  p_sale_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_line sale_lines%ROWTYPE;
  v_line_count integer := 0;
  v_allocation jsonb;
  v_total_cogs numeric := 0;
  v_now timestamptz := now();
  v_shift shifts%ROWTYPE;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale id is required.';
  END IF;

  -- 1. Lock the Sale FOR UPDATE.
  SELECT *
  INTO v_sale
  FROM sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale was not found.';
  END IF;

  -- 2. Validate status == draft.
  IF v_sale.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft sales can be confirmed.';
  END IF;

  -- 2a. Ensure a shift is open so this sale's confirmed_at falls inside a
  -- real shift window. Lock any existing open shift first; only insert a
  -- new one if none is found. See the file header for why FOR UPDATE alone
  -- cannot fully close this race, and why the INSERT below is additionally
  -- guarded against a concurrent winner.
  SELECT *
  INTO v_shift
  FROM shifts
  WHERE status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO shifts (status, opened_at, closed_at, opened_by)
      VALUES ('open', v_now, NULL, auth.uid())
      RETURNING * INTO v_shift;
    EXCEPTION WHEN unique_violation THEN
      -- Lost the race: a concurrent confirm_sale (or a manual
      -- openShift() click) inserted the open shift first. The row now
      -- exists, so lock and read it instead of failing this confirm.
      SELECT *
      INTO v_shift
      FROM shifts
      WHERE status = 'open'
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to open or find an active shift for this sale.';
      END IF;
    END;
  END IF;

  -- 3 / 4 / 5. Lock lines, require at least one, allocate FIFO per line,
  --    and sum COGS from allocation results.
  FOR v_line IN
    SELECT *
    FROM sale_lines
    WHERE sale_id = p_sale_id
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  LOOP
    v_allocation := allocate_finished_goods_fifo(
      v_line.product_id,
      v_line.quantity,
      'sale',
      'sale_line',
      v_line.id
    );

    v_total_cogs := v_total_cogs
      + COALESCE((v_allocation ->> 'total_cost')::numeric, 0);
    v_line_count := v_line_count + 1;
  END LOOP;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'Sale has no lines to confirm.';
  END IF;

  -- 6 / 7. Mark Sale confirmed and store confirmed_at.
  UPDATE sales
  SET
    status = 'confirmed',
    confirmed_at = v_now,
    updated_at = v_now
  WHERE id = p_sale_id;

  -- 8. Return sale_id + total_cogs (COGS snapshotted in ledger outs).
  RETURN jsonb_build_object(
    'sale_id', p_sale_id,
    'total_cogs', v_total_cogs
  );
END;
$$;

COMMENT ON FUNCTION confirm_sale(uuid) IS
  'Confirm a draft sale: ensure a shift is open (auto-opening one if none is), FIFO-allocate finished goods per line via allocate_finished_goods_fifo, then mark confirmed. COGS comes from ledger allocation totals only.';

-- anon holds its own direct grant on this project independent of PUBLIC
-- membership (see sql/074) -- both must be revoked explicitly (lesson from
-- the first failed rollout attempt of sql/076).
REVOKE ALL ON FUNCTION confirm_sale(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION confirm_sale(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION confirm_sale(uuid) TO authenticated;
