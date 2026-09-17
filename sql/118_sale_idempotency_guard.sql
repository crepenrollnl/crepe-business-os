-- Sale Idempotency Guard -- protect create_and_confirm_sale / confirm_sale
-- from a double network call (audit finding #9: POS network retry, double
-- click on the checkout button, or a duplicate "New" click on /sales before
-- the disabled-button state kicks in).
--
-- Run in Supabase SQL editor after sql/117_role_guard_journals_fifo_writeoffs.sql.
-- Apply on both databases (dev + prod), per CLAUDE_WORKFLOW.md's money-critical
-- / stock-critical protocol: Part 1 dry run (BEGIN...ROLLBACK, self-contained,
-- proves itself and leaves nothing behind), Part 2 the real migration
-- (BEGIN...COMMIT), Part 3 standalone post-commit verification queries run
-- OUTSIDE any transaction.
--
-- Background (this session's investigation, three rounds):
--   1. create_and_confirm_sale (POS, one-tap) and confirm_sale (the
--      /sales "New" -> add lines -> Confirm two-step path) had NO
--      protection against being called twice for the same intended sale.
--      create_and_confirm_sale is the riskier of the two: every call
--      unconditionally creates a brand-new draft (create_draft_sale
--      generates a new sale_number every time) and confirms it -- a
--      network retry or a double click before the "Confirming..." disabled
--      button state commits doubles the sale, doubles the Finished Goods
--      FIFO consumption, and doubles the GL posting.
--   2. total_cogs, confirm_sale's own return value, is never stored on
--      `sales` -- it is fully and reliably recomputable after the fact
--      from the two append-only ledgers confirm_sale itself writes to
--      (finished_goods_batch_consumptions, stock_movements), exactly the
--      way sale-cogs-service.ts and verify_sale_cost_and_profit (sql/090)
--      already do. This migration factors that recomputation into a new
--      small function, compute_sale_total_cogs(uuid), instead of writing
--      it a third time.
--   3. create_draft_sale is genuinely used standalone (the /sales "New"
--      button), independent of create_and_confirm_sale (the POS path) --
--      confirmed by reading sales-page.tsx / use-sales.ts / use-sale.ts.
--      Both RPCs need the same client_request_id treatment.
--   4. create_and_confirm_sale (including its nested confirm_sale call)
--      runs as a single atomic Postgres transaction -- confirmed by code
--      review (no dblink/autonomous_transaction/pg_background/explicit
--      COMMIT anywhere in this call chain) and, in this file's own dry
--      run (Scenario D below), empirically as well.
--   5. Follow-up finding on the first version of this migration: a plain
--      client_request_id lookup inside create_and_confirm_sale closes a
--      RETRY (second call after the first already committed) but not a
--      genuine RACE -- two calls with the SAME token starting at truly
--      the same instant could both see "not found" on the lookup and
--      both proceed into create_draft_sale, which only serializes at its
--      own INSERT. In that exact window the loser's create_draft_sale
--      call would silently adopt the winner's (still in-progress) sale_id
--      and then add ITS OWN lines onto that one sale -- doubling the
--      lines on a single sale instead of the ordinary "two sales" bug
--      this whole migration exists to prevent. Closed with a transactional
--      advisory lock keyed on the token -- see the Design section below.
--
-- Design (fixed by the review session -- implemented as specified, not
-- redesigned here):
--   - sales.client_request_id uuid, nullable. Partial unique index so only
--     non-null values are constrained -- every existing row (NULL) is
--     unaffected.
--   - create_draft_sale gains p_client_request_id uuid DEFAULT NULL. A
--     repeat call with a token that already has a sale returns that sale
--     (no second draft). A genuine insert race between two brand-new
--     concurrent calls for the same token is caught as unique_violation
--     and resolved the same way, mirroring confirm_sale's own
--     shift-race-recovery pattern (sql/079). This remains a real,
--     independently-useful guard for a direct create_draft_sale call (the
--     /sales "New" button never goes through create_and_confirm_sale) --
--     but for create_and_confirm_sale's own call into create_draft_sale,
--     it is now a second, backstop layer rather than the primary defense
--     against a true concurrent race (see the next bullet and finding #5
--     above).
--   - create_and_confirm_sale gains the same parameter, checked in this
--     order: (1) reject empty p_lines exactly as before, (2) if a token
--     was given, take a transactional advisory lock keyed on the token
--     (pg_advisory_xact_lock) BEFORE looking the token up, (3) look the
--     token up. A repeat call whose token already belongs to a
--     confirmed/paid sale returns that sale's frozen {sale_id,
--     total_cogs} (via compute_sale_total_cogs) instead of doing any work
--     again. A repeat call whose token belongs to a sale in any OTHER
--     status is treated as an anomaly (this RPC is fully atomic, so that
--     state should not exist) and RAISEs loudly instead of guessing what
--     to do. The advisory lock forces a genuinely concurrent second caller
--     to block until the first caller's entire transaction ends (commit
--     or rollback) before it even reaches its own lookup -- by the time it
--     does, the first caller's row is already committed and visible, so
--     the second caller takes the ordinary "already confirmed" branch
--     instead of racing anyone's INSERT.
--   - confirm_sale itself is intentionally NOT touched -- a repeat
--     "Confirm" click on an existing sale_id is already correctly
--     rejected by its own status = 'draft' check.
--
-- Deliberately NOT touched:
--   - verify_sale_cost_and_profit (sql/090) / verify_daily_profit_summary
--     (sql/092): both already independently recompute the same two-ledger
--     COGS sum inline. The task description allowed folding them onto
--     compute_sale_total_cogs "only if it's a safe refactor without any
--     risk" -- left alone here because these two RPCs exist specifically
--     to verify a sale's/shift's numbers *independently* of the code path
--     that produced them (server-side cross-check against the TS-computed
--     figures the UI displays). Making them call the exact same function
--     `create_and_confirm_sale` now also calls does not add real risk by
--     itself, but it does quietly reduce that independence for a
--     production financial-verification tool, for zero benefit to this
--     task's actual goal (stopping duplicate sales). Left as a candidate
--     for a deliberate, separately-reviewed follow-up, not bundled here.
--   - confirm_sale: unchanged, per the fixed design above.
--   - Anything about POS UI beyond wiring the new parameter through
--     (src/features/pos/hooks/use-pos-sale.ts) and the /sales "New" button
--     (src/features/sales/hooks/use-sales.ts) -- no visual changes.
--
-- Known, deliberately deferred verification gap (same category as the RLS
-- caveat in sql/117): a single Postgres session running one DO block
-- cannot manufacture two genuinely concurrent transactions, so this dry
-- run cannot empirically demonstrate either (a) the pg_advisory_xact_lock
-- serialization inside create_and_confirm_sale actually blocking a second,
-- truly-simultaneous caller, or (b) the unique_violation race-recovery
-- branch inside create_draft_sale actually firing from a real concurrent
-- INSERT collision. Both remain verified by code review only, not by this
-- dry run -- same honesty standard already applied to the RLS gap in
-- sql/117 and to the "unique_violation catch is untestable" note in the
-- first version of this file.
--
-- The confidence basis for (a) is NOT "it compiled" -- it rests on
-- pg_advisory_xact_lock being a standard, documented PostgreSQL primitive
-- (https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS):
-- pg_advisory_xact_lock(key) always blocks the calling session until the
-- lock is free, and a transaction-level advisory lock is ALWAYS released
-- automatically at the end of its transaction (COMMIT or ROLLBACK), with
-- no code path that can leak it or require a manual unlock. Combined with
-- finding #4 above (create_and_confirm_sale runs as exactly one Postgres
-- transaction, confirmed both by code review and empirically by this
-- file's own Scenario D), two calls sharing the same lock key inside the
-- same RPC are guaranteed to serialize for the full duration of whichever
-- call gets there first -- this is the same class of confidence ("standard
-- documented Postgres behavior" plus "this file's own empirical proof of
-- one surrounding fact") the atomicity conclusion in finding #4 already
-- relied on, not a new, weaker kind of assumption.
--
-- What IS verified empirically by this dry run for the advisory lock: that
-- pg_advisory_xact_lock(hashtext(p_client_request_id::text)::bigint) is
-- syntactically valid, does not itself throw, and does not change the
-- single-caller behavior of Scenarios A/B/C/D/E/F below (each still passes
-- with the lock statement now sitting in the call path). What it does NOT
-- and cannot verify: the actual blocking-and-serializing behavior under
-- real concurrency. See the NOTE at the end of the dry run's DO block, and
-- Part 3, section 3g for a structural (not behavioral) check that the lock
-- call is really present in the committed function body.

-- ============================================================================
-- PART 1 of 3 -- DRY RUN (safe to run first; self-contained, self-rolling-
-- back; creates its own throwaway recipes/production fixtures with a random
-- suffix and rolls all of it back at the end -- nothing persists)
-- ============================================================================

-- >>> DRY RUN START
BEGIN;

-- The dry run below calls the NEW (Part 2) function bodies, so Part 2's
-- CREATE OR REPLACE statements must already be visible to this same
-- session. Since this whole file runs top-to-bottom in one SQL Editor
-- paste, apply Part 2 first inside this dry-run transaction, prove it with
-- the DO block, then roll the whole thing back -- so the dry run is
-- proving the exact code Part 2 will commit, not a copy of it.

-- ---------------------------------------------------------------------------
-- 1a. schema (dry run copy of Part 2, section 1)
-- ---------------------------------------------------------------------------

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

CREATE UNIQUE INDEX IF NOT EXISTS sales_client_request_id_uidx
  ON sales (client_request_id)
  WHERE client_request_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 1b. compute_sale_total_cogs (dry run copy of Part 2, section 2)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION compute_sale_total_cogs(
  p_sale_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_finished_goods_cogs numeric;
  v_ingredient_cogs numeric;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale id is required.';
  END IF;

  SELECT COALESCE(SUM(fgbc.total_cost), 0)
  INTO v_finished_goods_cogs
  FROM finished_goods_batch_consumptions fgbc
  JOIN sale_lines sl ON sl.id = fgbc.source_id
  WHERE fgbc.source_type = 'sale_line'
    AND fgbc.direction = 'out'
    AND fgbc.reason = 'sale'
    AND sl.sale_id = p_sale_id;

  SELECT COALESCE(SUM(sm.quantity * sm.unit_cost), 0)
  INTO v_ingredient_cogs
  FROM stock_movements sm
  JOIN sale_lines sl ON sl.id = sm.reference_id
  WHERE sm.reference_type = 'sale'
    AND sm.movement_type = 'sale_out'
    AND sl.sale_id = p_sale_id;

  RETURN round(v_finished_goods_cogs + v_ingredient_cogs, 2);
END;
$$;

-- ---------------------------------------------------------------------------
-- 1c. create_draft_sale (dry run copy of Part 2, section 3)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS create_draft_sale(uuid, text, text);

CREATE OR REPLACE FUNCTION create_draft_sale(
  p_customer_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_kitchen_note text DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
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
  v_kitchen_note text;
  v_customer customers%ROWTYPE;
  v_now timestamptz := now();
  v_existing_id uuid;
BEGIN
  IF p_client_request_id IS NOT NULL THEN
    SELECT id
    INTO v_existing_id
    FROM sales
    WHERE client_request_id = p_client_request_id
    FOR UPDATE;

    IF FOUND THEN
      RETURN jsonb_build_object('sale_id', v_existing_id);
    END IF;
  END IF;

  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_kitchen_note := NULLIF(btrim(COALESCE(p_kitchen_note, '')), '');

  IF p_customer_id IS NOT NULL THEN
    SELECT *
    INTO v_customer
    FROM customers
    WHERE id = p_customer_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer was not found.';
    END IF;

    IF v_customer.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Inactive customers cannot be selected for new draft sales.';
    END IF;
  END IF;

  v_sale_number := 'S-' || lpad(nextval('sales_sale_number_seq')::text, 6, '0');

  BEGIN
    INSERT INTO sales (
      sale_number,
      customer_id,
      status,
      sale_date,
      notes,
      kitchen_note,
      client_request_id,
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
      v_kitchen_note,
      p_client_request_id,
      0,
      0,
      0,
      v_now,
      v_now
    )
    RETURNING id INTO v_sale_id;
  EXCEPTION WHEN unique_violation THEN
    IF p_client_request_id IS NULL THEN
      RAISE;
    END IF;

    SELECT id
    INTO v_existing_id
    FROM sales
    WHERE client_request_id = p_client_request_id;

    IF NOT FOUND THEN
      RAISE;
    END IF;

    RETURN jsonb_build_object('sale_id', v_existing_id);
  END;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 1d. create_and_confirm_sale (dry run copy of Part 2, section 4)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS create_and_confirm_sale(uuid, jsonb, text, text, numeric);

CREATE OR REPLACE FUNCTION create_and_confirm_sale(
  p_customer_id uuid DEFAULT NULL,
  p_lines jsonb DEFAULT NULL,
  p_kitchen_note text DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value numeric DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft jsonb;
  v_sale_id uuid;
  v_line jsonb;
  v_existing_id uuid;
  v_existing_status text;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Sale has no lines to confirm.';
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    -- Advisory lock closes the true-concurrency gap a plain
    -- client_request_id lookup cannot -- see Part 2, section 4 for the
    -- full comment; this is a byte-for-byte copy of that logic.
    PERFORM pg_advisory_xact_lock(hashtext(p_client_request_id::text)::bigint);

    SELECT id, status
    INTO v_existing_id, v_existing_status
    FROM sales
    WHERE client_request_id = p_client_request_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing_status IN ('confirmed', 'paid') THEN
        RETURN jsonb_build_object(
          'sale_id', v_existing_id,
          'total_cogs', compute_sale_total_cogs(v_existing_id)
        );
      END IF;

      RAISE EXCEPTION
        'Unexpected state: a sale (%) already exists for client_request_id % with status "%", not confirmed or paid. This request token should only ever be attached to a fully confirmed sale by the time it is seen again -- refusing to silently add lines or confirm on its behalf.',
        v_existing_id, p_client_request_id, v_existing_status;
    END IF;
  END IF;

  v_draft := create_draft_sale(p_customer_id, NULL, p_kitchen_note, p_client_request_id);
  v_sale_id := (v_draft ->> 'sale_id')::uuid;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    PERFORM add_sale_line(
      v_sale_id,
      (v_line ->> 'product_id')::uuid,
      (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price')::numeric
    );
  END LOOP;

  IF p_discount_type IS NOT NULL OR p_discount_value IS NOT NULL THEN
    PERFORM apply_sale_header_discount(
      v_sale_id,
      p_discount_type,
      p_discount_value
    );
  END IF;

  RETURN confirm_sale(v_sale_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 1e. test scenarios (a)-(f)
-- ---------------------------------------------------------------------------

DO $test$
DECLARE
  v_actor uuid;
  v_claims text;
  v_suffix text := replace(gen_random_uuid()::text, '-', '');

  v_recipe_component uuid;
  v_recipe_assembly uuid;
  v_recipe_broken uuid;

  v_plan_dummy uuid;
  v_plan_product_dummy uuid;
  v_session_dummy uuid;
  v_line_dummy uuid;

  v_token_a uuid := gen_random_uuid();
  v_token_c uuid := gen_random_uuid();
  v_token_d uuid := gen_random_uuid();
  v_token_e uuid := gen_random_uuid();
  v_token_e2 uuid := gen_random_uuid();
  v_token_f uuid := gen_random_uuid();

  v_result_a jsonb;
  v_result_b jsonb;
  v_result_c jsonb;
  v_sale_id_a uuid;
  v_sale_id_b uuid;
  v_sale_id_c uuid;
  v_total_cogs_a numeric;

  v_count integer;
  v_consumed_before numeric;
  v_consumed_after numeric;

  v_draft_e1 jsonb;
  v_draft_e2 jsonb;
  v_draft_e3 jsonb;
  v_sale_id_e1 uuid;
  v_sale_id_e2 uuid;
  v_sale_id_e3 uuid;

  v_err text;
BEGIN
  -- --- Emulate an authenticated owner/partner JWT (same mechanism as
  -- sql/106/116/117). ---------------------------------------------------
  SELECT p.auth_user_id
  INTO v_actor
  FROM profiles p
  WHERE p.is_active = true
    AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION
      'No active owner/partner row in profiles -- cannot emulate an authenticated caller.';
  END IF;

  v_claims := json_build_object(
    'sub', v_actor::text,
    'role', 'authenticated'
  )::text;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);

  IF auth.uid() IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION
      'auth.uid() emulation failed (got %, expected %).', auth.uid(), v_actor;
  END IF;

  RAISE NOTICE 'JWT emulated auth.uid()=%', auth.uid();

  -- --- Fixture: one assembly product with real Finished Goods stock,
  -- plus one deliberately-broken assembly for scenario (d). The
  -- production_batch is inserted directly (same shortcut
  -- sql/106_empirical_zero_cost_guard_dev.sql uses for its own "dummy"
  -- batch) instead of running a real complete_production_session, since
  -- this test only needs FIFO stock to exist. ---------------------------

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_SALE_IDEMPOTENCY_118_component_' || v_suffix, 1, 'pcs', true, 'component')
  RETURNING id INTO v_recipe_component;

  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_SALE_IDEMPOTENCY_118_assembly_' || v_suffix, 1, 'pcs', true, 'assembly')
  RETURNING id INTO v_recipe_assembly;

  INSERT INTO recipe_components (assembly_recipe_id, component_recipe_id, ingredient_id, quantity, unit)
  VALUES (v_recipe_assembly, v_recipe_component, NULL, 1, 'pcs');

  -- Deliberately broken: is_active, recipe_role = 'assembly', zero
  -- recipe_components rows. confirm_sale (sql/089) RAISEs 'Recipe "%" has
  -- no components defined...' for exactly this shape -- the natural way
  -- to force a failure partway through create_and_confirm_sale (scenario
  -- D) without touching any of its code.
  INSERT INTO recipes (name, yield_quantity, yield_unit, is_active, recipe_role)
  VALUES ('TEST_SALE_IDEMPOTENCY_118_broken_' || v_suffix, 1, 'pcs', true, 'assembly')
  RETURNING id INTO v_recipe_broken;

  INSERT INTO production_plans (name, planning_date, status)
  VALUES ('TEST_SALE_IDEMPOTENCY_118_plan_' || v_suffix, CURRENT_DATE, 'completed')
  RETURNING id INTO v_plan_dummy;

  INSERT INTO production_plan_products (
    production_plan_id, recipe_id, recipe_name, planned_quantity, yield_quantity, yield_unit, sort_order
  )
  VALUES (
    v_plan_dummy, v_recipe_component, 'TEST_SALE_IDEMPOTENCY_118_component_' || v_suffix, 10, 1, 'pcs', 1
  )
  RETURNING id INTO v_plan_product_dummy;

  INSERT INTO production_sessions (production_plan_id, status, started_at)
  VALUES (v_plan_dummy, 'in_progress', now())
  RETURNING id INTO v_session_dummy;

  INSERT INTO production_session_lines (
    production_session_id, production_plan_product_id, recipe_id, product_name,
    planned_quantity, actual_produced_quantity, yield_unit, sort_order
  )
  VALUES (
    v_session_dummy, v_plan_product_dummy, v_recipe_component,
    'TEST_SALE_IDEMPOTENCY_118_component_' || v_suffix, 10, 10, 'pcs', 1
  )
  RETURNING id INTO v_line_dummy;

  UPDATE production_sessions
  SET status = 'completed', completed_at = now()
  WHERE id = v_session_dummy;

  INSERT INTO production_batches (
    production_session_id, production_session_line_id, finished_good_id, recipe_id,
    produced_quantity, unit_cost, produced_at
  )
  VALUES (
    v_session_dummy, v_line_dummy, v_recipe_component, v_recipe_component,
    10, 2.00, now() - interval '1 hour'
  );

  -- ========================================================================
  -- SCENARIO (a): first call with a brand-new client_request_id creates a
  -- sale exactly as before.
  -- ========================================================================
  v_result_a := create_and_confirm_sale(
    NULL,
    jsonb_build_array(
      jsonb_build_object('product_id', v_recipe_assembly, 'quantity', 1, 'unit_price', 10.00)
    ),
    NULL, NULL, NULL,
    v_token_a
  );

  v_sale_id_a := (v_result_a ->> 'sale_id')::uuid;
  v_total_cogs_a := (v_result_a ->> 'total_cogs')::numeric;

  IF v_sale_id_a IS NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: create_and_confirm_sale returned no sale_id (%).', v_result_a;
  END IF;

  SELECT count(*) INTO v_count FROM sales WHERE client_request_id = v_token_a;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: expected exactly 1 sale for client_request_id %, found %.', v_token_a, v_count;
  END IF;

  IF (SELECT status FROM sales WHERE id = v_sale_id_a) <> 'confirmed' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: sale % is not confirmed.', v_sale_id_a;
  END IF;

  RAISE NOTICE 'SCENARIO A PASS: sale % created and confirmed, total_cogs=%', v_sale_id_a, v_total_cogs_a;

  -- ========================================================================
  -- SCENARIO (b): repeat call with the SAME client_request_id must return
  -- the SAME sale, must NOT create a second sales row, must NOT allocate
  -- Finished Goods a second time, and total_cogs must match exactly.
  -- ========================================================================
  SELECT count(*) INTO v_count
  FROM finished_goods_batch_consumptions fgbc
  JOIN sale_lines sl ON sl.id = fgbc.source_id
  WHERE sl.sale_id = v_sale_id_a;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SCENARIO B SETUP FAIL: expected exactly 1 FIFO consumption row for sale % before the repeat call, found %.', v_sale_id_a, v_count;
  END IF;

  v_result_b := create_and_confirm_sale(
    NULL,
    jsonb_build_array(
      jsonb_build_object('product_id', v_recipe_assembly, 'quantity', 1, 'unit_price', 10.00)
    ),
    NULL, NULL, NULL,
    v_token_a
  );

  v_sale_id_b := (v_result_b ->> 'sale_id')::uuid;

  IF v_sale_id_b IS DISTINCT FROM v_sale_id_a THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: repeat call returned a different sale_id (% vs %).', v_sale_id_b, v_sale_id_a;
  END IF;

  IF (v_result_b ->> 'total_cogs')::numeric IS DISTINCT FROM v_total_cogs_a THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: total_cogs changed on repeat call (% vs %).', (v_result_b ->> 'total_cogs')::numeric, v_total_cogs_a;
  END IF;

  SELECT count(*) INTO v_count FROM sales WHERE client_request_id = v_token_a;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: expected exactly 1 sale for client_request_id % after the repeat call, found %.', v_token_a, v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM finished_goods_batch_consumptions fgbc
  JOIN sale_lines sl ON sl.id = fgbc.source_id
  WHERE sl.sale_id = v_sale_id_a;

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: expected exactly 1 FIFO consumption row for sale % after the repeat call, found %.', v_sale_id_a, v_count;
  END IF;

  RAISE NOTICE 'SCENARIO B PASS: repeat call with the same token returned the same sale % and the same total_cogs=% -- no duplicate row, no double FIFO consumption.', v_sale_id_a, v_total_cogs_a;

  -- ========================================================================
  -- SCENARIO (c): a DIFFERENT client_request_id creates an independent
  -- second sale as normal -- proves the dedup does not break the ordinary,
  -- non-duplicate case.
  -- ========================================================================
  v_result_c := create_and_confirm_sale(
    NULL,
    jsonb_build_array(
      jsonb_build_object('product_id', v_recipe_assembly, 'quantity', 1, 'unit_price', 10.00)
    ),
    NULL, NULL, NULL,
    v_token_c
  );

  v_sale_id_c := (v_result_c ->> 'sale_id')::uuid;

  IF v_sale_id_c IS NULL OR v_sale_id_c = v_sale_id_a THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: expected a new, distinct sale id, got %.', v_sale_id_c;
  END IF;

  SELECT count(*) INTO v_count FROM sales WHERE client_request_id = v_token_c;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: expected exactly 1 sale for client_request_id %, found %.', v_token_c, v_count;
  END IF;

  RAISE NOTICE 'SCENARIO C PASS: a different token created an independent second sale %.', v_sale_id_c;

  -- ========================================================================
  -- SCENARIO (d): force a mid-call exception inside confirm_sale (second
  -- cart line references the deliberately-broken assembly with zero
  -- recipe_components -- confirm_sale RAISEs partway through its per-line
  -- loop, after the first line's own FIFO allocation already ran) and
  -- prove the WHOLE call rolled back: no sales row survives for this
  -- token, and Finished Goods shows no leaked consumption from the first
  -- line's now-rolled-back allocation. This is the empirical atomicity
  -- check the code-only investigation could not run without DB access.
  -- ========================================================================
  SELECT COALESCE(SUM(fgbc.quantity) FILTER (WHERE fgbc.direction = 'out'), 0)
       - COALESCE(SUM(fgbc.quantity) FILTER (WHERE fgbc.direction = 'in'), 0)
  INTO v_consumed_before
  FROM finished_goods_batch_consumptions fgbc
  JOIN production_batches pb ON pb.id = fgbc.production_batch_id
  WHERE pb.finished_good_id = v_recipe_component;

  BEGIN
    PERFORM create_and_confirm_sale(
      NULL,
      jsonb_build_array(
        jsonb_build_object('product_id', v_recipe_assembly, 'quantity', 1, 'unit_price', 10.00),
        jsonb_build_object('product_id', v_recipe_broken, 'quantity', 1, 'unit_price', 10.00)
      ),
      NULL, NULL, NULL,
      v_token_d
    );
    RAISE EXCEPTION 'SCENARIO D FAIL: create_and_confirm_sale unexpectedly succeeded with a broken second line.';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO D FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%has no components defined%' THEN
        RAISE EXCEPTION 'SCENARIO D FAIL: unexpected error (expected the no-components RAISE): %', v_err;
      END IF;
      RAISE NOTICE 'SCENARIO D: induced failure as expected: %', v_err;
  END;

  SELECT count(*) INTO v_count FROM sales WHERE client_request_id = v_token_d;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: expected NO sale row to survive for client_request_id % after the induced failure, found %. The transaction did not roll back atomically.', v_token_d, v_count;
  END IF;

  SELECT COALESCE(SUM(fgbc.quantity) FILTER (WHERE fgbc.direction = 'out'), 0)
       - COALESCE(SUM(fgbc.quantity) FILTER (WHERE fgbc.direction = 'in'), 0)
  INTO v_consumed_after
  FROM finished_goods_batch_consumptions fgbc
  JOIN production_batches pb ON pb.id = fgbc.production_batch_id
  WHERE pb.finished_good_id = v_recipe_component;

  IF v_consumed_after IS DISTINCT FROM v_consumed_before THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: Finished Goods consumption for % changed from % to % after the induced failure -- the first line''s allocation was not rolled back with the rest of the call.', v_recipe_component, v_consumed_before, v_consumed_after;
  END IF;

  RAISE NOTICE 'SCENARIO D PASS: after an induced mid-call failure, no sales row and no leaked Finished Goods consumption survived -- confirms create_and_confirm_sale (including its nested confirm_sale call) runs as one atomic transaction, exactly as the code-only investigation concluded without being able to verify it empirically.';

  -- ========================================================================
  -- SCENARIO (e): create_draft_sale itself (the standalone /sales "New"
  -- path) is idempotent on client_request_id, independent of
  -- create_and_confirm_sale, and never confirms.
  -- ========================================================================
  v_draft_e1 := create_draft_sale(NULL, NULL, NULL, v_token_e);
  v_sale_id_e1 := (v_draft_e1 ->> 'sale_id')::uuid;

  IF v_sale_id_e1 IS NULL THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: create_draft_sale returned no sale_id (%).', v_draft_e1;
  END IF;

  v_draft_e2 := create_draft_sale(NULL, NULL, NULL, v_token_e);
  v_sale_id_e2 := (v_draft_e2 ->> 'sale_id')::uuid;

  IF v_sale_id_e2 IS DISTINCT FROM v_sale_id_e1 THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: repeat create_draft_sale call with the same token returned a different sale_id (% vs %).', v_sale_id_e2, v_sale_id_e1;
  END IF;

  SELECT count(*) INTO v_count FROM sales WHERE client_request_id = v_token_e;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: expected exactly 1 sale for client_request_id %, found %.', v_token_e, v_count;
  END IF;

  IF (SELECT status FROM sales WHERE id = v_sale_id_e1) <> 'draft' THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: create_draft_sale must never confirm a sale, but % is not draft.', v_sale_id_e1;
  END IF;

  v_draft_e3 := create_draft_sale(NULL, NULL, NULL, v_token_e2);
  v_sale_id_e3 := (v_draft_e3 ->> 'sale_id')::uuid;

  IF v_sale_id_e3 IS NULL OR v_sale_id_e3 = v_sale_id_e1 THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: a different token should create a new, distinct draft sale, got %.', v_sale_id_e3;
  END IF;

  RAISE NOTICE 'SCENARIO E PASS: create_draft_sale is idempotent per client_request_id (% reused, % independent) and never confirms.', v_sale_id_e1, v_sale_id_e3;

  -- ========================================================================
  -- SCENARIO (f) (extra, beyond the requested a-e): the anomaly branch --
  -- a client_request_id attached to a sale that is NOT confirmed/paid must
  -- make create_and_confirm_sale RAISE loudly instead of silently adding
  -- lines/confirming on the caller's behalf. Scenario D already confirmed
  -- this state is unreachable through the real RPC (full atomicity); this
  -- manufactures it directly with a raw INSERT purely to exercise the
  -- guard branch itself.
  -- ========================================================================
  INSERT INTO sales (
    sale_number, customer_id, status, sale_date, client_request_id,
    subtotal, tax_total, total, created_at, updated_at
  )
  VALUES (
    'S-TEST118-' || left(v_suffix, 6), NULL, 'draft', CURRENT_DATE, v_token_f,
    0, 0, 0, now(), now()
  );

  BEGIN
    PERFORM create_and_confirm_sale(
      NULL,
      jsonb_build_array(
        jsonb_build_object('product_id', v_recipe_assembly, 'quantity', 1, 'unit_price', 10.00)
      ),
      NULL, NULL, NULL,
      v_token_f
    );
    RAISE EXCEPTION 'SCENARIO F FAIL: create_and_confirm_sale unexpectedly succeeded against a manufactured non-confirmed row for its own token.';
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      IF v_err LIKE 'SCENARIO F FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%Unexpected state%' THEN
        RAISE EXCEPTION 'SCENARIO F FAIL: unexpected error (expected the anomaly RAISE): %', v_err;
      END IF;
      RAISE NOTICE 'SCENARIO F PASS: anomaly guard raised loudly instead of silently continuing: %', v_err;
  END;

  RAISE NOTICE 'sql/118 dry run: all scenarios (A-F) passed.';
  RAISE NOTICE 'NOTE: neither the pg_advisory_xact_lock serialization inside create_and_confirm_sale nor the unique_violation race-recovery branch inside create_draft_sale (both meant for two truly concurrent Postgres transactions sharing the same brand-new client_request_id) can be exercised from this single-session DO block -- same category of deliberately-deferred verification as sql/117''s RLS caveat. Both are verified by code review and by documented PostgreSQL behavior only, not empirically, in this dry run -- see the file header for the confidence basis.';
END;
$test$;

ROLLBACK;
-- <<< DRY RUN END

-- ============================================================================
-- PART 2 of 3 -- THE MIGRATION (apply this for real, after Part 1 has passed)
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. sales.client_request_id + partial unique index
-- ---------------------------------------------------------------------------

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

COMMENT ON COLUMN sales.client_request_id IS
  'Optional client-generated idempotency token: one UUID per checkout/draft-creation attempt, generated in the browser before the first network call. A repeat create_and_confirm_sale/create_draft_sale call carrying the same token returns the existing sale instead of creating a second one (sql/118, audit finding #9). NULL for every sale created before this column existed or through any path that does not send one -- NULL values are unconstrained by the partial unique index below.';

CREATE UNIQUE INDEX IF NOT EXISTS sales_client_request_id_uidx
  ON sales (client_request_id)
  WHERE client_request_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. compute_sale_total_cogs -- shared recomputation, used by the
--    create_and_confirm_sale replay path below. NOT wired into
--    sql/090 / sql/092 -- see the file header for why.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION compute_sale_total_cogs(
  p_sale_id uuid
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_finished_goods_cogs numeric;
  v_ingredient_cogs numeric;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Sale id is required.';
  END IF;

  -- Component-recipe_id part of an assembly (or a directly-sold
  -- component): FIFO-allocated finished goods. Mirrors confirm_sale's own
  -- component branch (sql/089) and verify_sale_cost_and_profit's (sql/090)
  -- first ledger sum exactly -- same filters.
  SELECT COALESCE(SUM(fgbc.total_cost), 0)
  INTO v_finished_goods_cogs
  FROM finished_goods_batch_consumptions fgbc
  JOIN sale_lines sl ON sl.id = fgbc.source_id
  WHERE fgbc.source_type = 'sale_line'
    AND fgbc.direction = 'out'
    AND fgbc.reason = 'sale'
    AND sl.sale_id = p_sale_id;

  -- ingredient_id part of an assembly (sql/089): direct raw-ingredient
  -- decrement, recorded as a stock_movements row instead of a
  -- finished_goods_batch_consumptions row. Mirrors confirm_sale's own
  -- ingredient branch and verify_sale_cost_and_profit's (sql/090) second
  -- ledger sum exactly -- same filters, same quantity * unit_cost.
  SELECT COALESCE(SUM(sm.quantity * sm.unit_cost), 0)
  INTO v_ingredient_cogs
  FROM stock_movements sm
  JOIN sale_lines sl ON sl.id = sm.reference_id
  WHERE sm.reference_type = 'sale'
    AND sm.movement_type = 'sale_out'
    AND sl.sale_id = p_sale_id;

  RETURN round(v_finished_goods_cogs + v_ingredient_cogs, 2);
END;
$$;

COMMENT ON FUNCTION compute_sale_total_cogs(uuid) IS
  'Recompute a sale''s total_cogs from the two append-only ledgers confirm_sale itself writes to (finished_goods_batch_consumptions + stock_movements), exactly mirroring confirm_sale''s own two branches (sql/089) and verify_sale_cost_and_profit''s (sql/090) ledger sums. Does not validate sale existence or status -- callers (create_and_confirm_sale''s idempotent-replay path, sql/118) are responsible for that. Only used to reproduce confirm_sale''s own already-frozen figure for a replayed create_and_confirm_sale request -- never used to change what a fresh confirm_sale call itself returns.';

REVOKE ALL ON FUNCTION compute_sale_total_cogs(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION compute_sale_total_cogs(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION compute_sale_total_cogs(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. create_draft_sale -- add p_client_request_id, idempotent on it
--
-- New trailing parameter changes the function's signature (uuid, text,
-- text) -> (uuid, text, text, uuid); Postgres treats that as a distinct
-- overload rather than a replacement, so the old 3-arg signature must be
-- dropped first -- same reasoning sql/107's own header comment gives for
-- why it dropped the 2-arg overload when adding p_kitchen_note.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS create_draft_sale(uuid, text, text);

CREATE OR REPLACE FUNCTION create_draft_sale(
  p_customer_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_kitchen_note text DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
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
  v_kitchen_note text;
  v_customer customers%ROWTYPE;
  v_now timestamptz := now();
  v_existing_id uuid;
BEGIN
  -- Idempotency guard (sql/118, audit finding #9): a repeat call carrying
  -- a client_request_id that already has a sale returns that sale instead
  -- of creating a second one (network retry, or a double "New" click on
  -- the /sales page before the disabled-button state takes effect).
  -- Locked FOR UPDATE, same pattern confirm_sale itself already uses for
  -- the open-shift race (sql/079). This lock only helps once a row
  -- already exists -- it cannot by itself close the race between two
  -- brand-new concurrent calls that both see "not found" here; the
  -- unique_violation catch below is what closes that race.
  IF p_client_request_id IS NOT NULL THEN
    SELECT id
    INTO v_existing_id
    FROM sales
    WHERE client_request_id = p_client_request_id
    FOR UPDATE;

    IF FOUND THEN
      RETURN jsonb_build_object('sale_id', v_existing_id);
    END IF;
  END IF;

  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');
  v_kitchen_note := NULLIF(btrim(COALESCE(p_kitchen_note, '')), '');

  IF p_customer_id IS NOT NULL THEN
    SELECT *
    INTO v_customer
    FROM customers
    WHERE id = p_customer_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Customer was not found.';
    END IF;

    IF v_customer.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Inactive customers cannot be selected for new draft sales.';
    END IF;
  END IF;

  v_sale_number := 'S-' || lpad(nextval('sales_sale_number_seq')::text, 6, '0');

  BEGIN
    INSERT INTO sales (
      sale_number,
      customer_id,
      status,
      sale_date,
      notes,
      kitchen_note,
      client_request_id,
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
      v_kitchen_note,
      p_client_request_id,
      0,
      0,
      0,
      v_now,
      v_now
    )
    RETURNING id INTO v_sale_id;
  EXCEPTION WHEN unique_violation THEN
    -- Lost the race: a concurrent create_draft_sale call for the same
    -- client_request_id inserted first (see the comment above -- the
    -- earlier FOR UPDATE lookup cannot catch this by itself when both
    -- calls start from "not found"). Same recover-by-re-reading pattern
    -- confirm_sale uses for the open-shift race (sql/079). If the
    -- violation was actually sales_sale_number_key instead (unrelated to
    -- this token), the re-read below finds nothing and re-raises the
    -- original error unchanged.
    IF p_client_request_id IS NULL THEN
      RAISE;
    END IF;

    SELECT id
    INTO v_existing_id
    FROM sales
    WHERE client_request_id = p_client_request_id;

    IF NOT FOUND THEN
      RAISE;
    END IF;

    RETURN jsonb_build_object('sale_id', v_existing_id);
  END;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id
  );
END;
$$;

COMMENT ON FUNCTION create_draft_sale(uuid, text, text, uuid) IS
  'Create a draft sale header only (no lines). Guest sales allowed (null customer_id). Non-null customer_id must reference an active customer. p_kitchen_note writes sales.kitchen_note, never sales.notes. p_client_request_id is an optional client-generated idempotency token (sql/118): a repeat call with the same token returns the existing sale instead of creating a second one, including under a genuine insert race (unique_violation on sales_client_request_id_uidx).';

REVOKE ALL ON FUNCTION create_draft_sale(uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_draft_sale(uuid, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION create_draft_sale(uuid, text, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. create_and_confirm_sale -- add p_client_request_id, idempotent on it
--
-- Same overload-vs-replace reasoning as section 3: the new trailing
-- parameter is a distinct signature, so the current 5-arg overload
-- (sql/110) must be dropped first.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS create_and_confirm_sale(uuid, jsonb, text, text, numeric);

CREATE OR REPLACE FUNCTION create_and_confirm_sale(
  p_customer_id uuid DEFAULT NULL,
  p_lines jsonb DEFAULT NULL,
  p_kitchen_note text DEFAULT NULL,
  p_discount_type text DEFAULT NULL,
  p_discount_value numeric DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft jsonb;
  v_sale_id uuid;
  v_line jsonb;
  v_existing_id uuid;
  v_existing_status text;
BEGIN
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Sale has no lines to confirm.';
  END IF;

  -- Idempotency guard (sql/118, audit finding #9): a repeat call carrying
  -- the same client_request_id as an already-confirmed sale must not
  -- create a second sale, allocate stock twice, or run confirm_sale a
  -- second time -- it returns the frozen result of the sale that already
  -- exists instead.
  --
  -- The advisory lock immediately below closes a true-concurrency gap a
  -- plain client_request_id lookup cannot: two genuinely simultaneous
  -- calls sharing the SAME token would otherwise both see "not found" on
  -- the SELECT that follows and both proceed into create_draft_sale,
  -- which only serializes at its own INSERT (create_draft_sale's own
  -- unique_violation catch, sql/118 section 3, is kept as a second,
  -- backstop layer for THAT -- for a direct create_draft_sale call
  -- bypassing this RPC entirely -- not as the primary defense for this
  -- particular race any more). pg_advisory_xact_lock is a standard,
  -- documented Postgres primitive: the lock is held for exactly the rest
  -- of the current transaction and released automatically on commit OR
  -- rollback, with no explicit unlock required -- and this whole RPC call
  -- is one transaction (empirically confirmed by Scenario D below). A
  -- second, truly-concurrent call sharing the same token blocks here until
  -- the first call's transaction ends, then proceeds into its own SELECT
  -- below and finds the first call's already-committed row -- taking the
  -- ordinary "already confirmed" replay branch immediately below, never
  -- racing anyone's INSERT.
  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(p_client_request_id::text)::bigint);

    SELECT id, status
    INTO v_existing_id, v_existing_status
    FROM sales
    WHERE client_request_id = p_client_request_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing_status IN ('confirmed', 'paid') THEN
        RETURN jsonb_build_object(
          'sale_id', v_existing_id,
          'total_cogs', compute_sale_total_cogs(v_existing_id)
        );
      END IF;

      -- create_and_confirm_sale composes create_draft_sale + add_sale_line
      -- + confirm_sale inside one atomic RPC call (this session's own
      -- transaction-atomicity investigation, empirically re-confirmed by
      -- this file's own dry-run Scenario D). A row that exists for this
      -- exact token but never reached 'confirmed'/'paid' should be
      -- impossible under normal operation. Surface it loudly instead of
      -- silently finishing the job on the caller's behalf (no auto-add
      -- lines, no auto-confirm here).
      RAISE EXCEPTION
        'Unexpected state: a sale (%) already exists for client_request_id % with status "%", not confirmed or paid. This request token should only ever be attached to a fully confirmed sale by the time it is seen again -- refusing to silently add lines or confirm on its behalf.',
        v_existing_id, p_client_request_id, v_existing_status;
    END IF;
  END IF;

  v_draft := create_draft_sale(p_customer_id, NULL, p_kitchen_note, p_client_request_id);
  v_sale_id := (v_draft ->> 'sale_id')::uuid;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    PERFORM add_sale_line(
      v_sale_id,
      (v_line ->> 'product_id')::uuid,
      (v_line ->> 'quantity')::numeric,
      (v_line ->> 'unit_price')::numeric
    );
  END LOOP;

  IF p_discount_type IS NOT NULL OR p_discount_value IS NOT NULL THEN
    PERFORM apply_sale_header_discount(
      v_sale_id,
      p_discount_type,
      p_discount_value
    );
  END IF;

  RETURN confirm_sale(v_sale_id);
END;
$$;

COMMENT ON FUNCTION create_and_confirm_sale(uuid, jsonb, text, text, numeric, uuid) IS
  'One-tap sale: atomically create a draft sale, add every line in p_lines, then confirm it. Optional p_kitchen_note is sales.kitchen_note only. Optional p_client_request_id (sql/118) is a client-generated idempotency token: before looking the token up, a pg_advisory_xact_lock keyed on the token serializes any genuinely concurrent caller sharing it, so a repeat OR a truly-racing call with the same token as an already-confirmed/paid sale returns that sale''s frozen {sale_id, total_cogs} (via compute_sale_total_cogs) instead of creating a second sale; a call whose token matches a non-confirmed row raises loudly instead of guessing. Reuses create_draft_sale + add_sale_line + apply_sale_header_discount + confirm_sale unchanged.';

REVOKE ALL ON FUNCTION create_and_confirm_sale(uuid, jsonb, text, text, numeric, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_and_confirm_sale(uuid, jsonb, text, text, numeric, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION create_and_confirm_sale(uuid, jsonb, text, text, numeric, uuid) TO authenticated;

COMMIT;

-- ============================================================================
-- PART 3 of 3 -- STANDALONE POST-COMMIT VERIFICATION (run each query on its
-- own, OUTSIDE any transaction, after Part 2 has actually committed)
-- ============================================================================

-- 3a. Column + partial unique index exist with the right shape.
SELECT
  a.attname,
  format_type(a.atttypid, a.atttypmod) AS data_type,
  a.attnotnull AS not_null
FROM pg_attribute a
WHERE a.attrelid = 'sales'::regclass
  AND a.attname = 'client_request_id'
  AND a.attnum > 0
  AND NOT a.attisdropped;
-- Expect: one row, data_type = uuid, not_null = false.

SELECT indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'sales'
  AND indexname = 'sales_client_request_id_uidx';
-- Expect: one row, definition includes
-- "WHERE (client_request_id IS NOT NULL)".

-- 3b. Function bodies actually contain the new parameter / logic (proves
-- the CREATE OR REPLACE really landed, not just "no error").
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  position('p_client_request_id' in pg_get_functiondef(p.oid)) > 0 AS has_client_request_id
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('create_draft_sale', 'create_and_confirm_sale', 'compute_sale_total_cogs')
ORDER BY p.proname;
-- Expect: create_draft_sale(uuid, text, text, uuid) and
-- create_and_confirm_sale(uuid, jsonb, text, text, numeric, uuid), both
-- has_client_request_id = true; compute_sale_total_cogs(uuid) present.

-- 3c. The old, now-superseded overloads are actually gone (DROP FUNCTION
-- really ran, not skipped).
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('create_draft_sale', 'create_and_confirm_sale');
-- Expect: exactly one row per function name (the new signature only) --
-- if either name has 2 rows, the DROP FUNCTION did not take effect and
-- PostgREST now has an ambiguous overload to resolve.

-- 3d. EXECUTE privileges are exactly as intended: PUBLIC/anon blocked,
-- authenticated allowed, on all three touched/created functions.
SELECT
  'create_draft_sale' AS fn,
  has_function_privilege('anon', 'create_draft_sale(uuid, text, text, uuid)', 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', 'create_draft_sale(uuid, text, text, uuid)', 'EXECUTE') AS authenticated_can_execute
UNION ALL
SELECT
  'create_and_confirm_sale',
  has_function_privilege('anon', 'create_and_confirm_sale(uuid, jsonb, text, text, numeric, uuid)', 'EXECUTE'),
  has_function_privilege('authenticated', 'create_and_confirm_sale(uuid, jsonb, text, text, numeric, uuid)', 'EXECUTE')
UNION ALL
SELECT
  'compute_sale_total_cogs',
  has_function_privilege('anon', 'compute_sale_total_cogs(uuid)', 'EXECUTE'),
  has_function_privilege('authenticated', 'compute_sale_total_cogs(uuid)', 'EXECUTE');
-- Expect: anon_can_execute = false and authenticated_can_execute = true
-- on all three rows.

-- 3e. sql/090 and sql/092 were deliberately NOT touched by this migration
-- -- confirm neither now references compute_sale_total_cogs (would
-- indicate an accidental edit outside this file's stated scope).
SELECT
  p.proname,
  position('compute_sale_total_cogs' in pg_get_functiondef(p.oid)) > 0 AS references_new_function
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('verify_sale_cost_and_profit', 'verify_daily_profit_summary');
-- Expect: references_new_function = false for both rows.

-- 3f. Existing sales are unaffected: every pre-existing row still has
-- client_request_id IS NULL (no backfill was performed, none was needed).
SELECT count(*) AS pre_existing_rows_with_token
FROM sales
WHERE client_request_id IS NOT NULL
  AND created_at < now() - interval '1 hour';
-- Expect: 0 (adjust the interval if this is run long after the migration
-- and real sales have since been made with real tokens -- the point is
-- that no row from BEFORE this migration ran suddenly has a token).

-- 3g. Structural (not behavioral) proof that the advisory-lock fix for
-- the true-concurrency race (finding #5 in the file header) actually
-- landed in the committed function body -- a real concurrent-session test
-- is the only way to prove the LOCKING behavior itself (see the file
-- header's confidence-basis note); this only proves the call is present,
-- textually, in what actually got committed.
SELECT
  p.proname,
  position('pg_advisory_xact_lock' in pg_get_functiondef(p.oid)) > 0 AS has_advisory_lock_call,
  position('hashtext(p_client_request_id::text)' in pg_get_functiondef(p.oid)) > 0 AS lock_key_is_hashed_token
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname = 'create_and_confirm_sale';
-- Expect: one row, has_advisory_lock_call = true, lock_key_is_hashed_token
-- = true.
