-- SQL test: sql/139 — mark_sale_queued / mark_sale_fulfilled (audit S1 step 2a).
-- Not a migration. Always ends in ROLLBACK. Do not COMMIT.
-- Do not run against crepe-business-V1.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/sales_kitchen_queue_rpcs.sql
-- (exit 0) after a full replay of sql/*.sql.
--
-- Scenarios:
--   A — seller queues a ready sale; repeat is a no-op
--   B — seller marks it ready with the server clock; repeat keeps the timestamp
--   C — nothing but fulfilled_at changes
--   D — draft sale / unknown id / NULL are refused
--   E — owner/partner can use them too
--   F — a user without an active profile is refused (42501), nothing changes
--   G — anon has no EXECUTE
--   H — SECURITY DEFINER, search_path, grants

BEGIN;

CREATE OR REPLACE FUNCTION public.dryrun139_expect(
  p_label text, p_sqlstate text, p_message_like text, p_sql text
)
RETURNS void
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_state text;
  v_err text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_err = MESSAGE_TEXT;
      IF v_state IS DISTINCT FROM p_sqlstate OR v_err NOT ILIKE p_message_like THEN
        RAISE EXCEPTION '% FAIL: expected % [%] got % [%] for: %',
          p_label, p_sqlstate, p_message_like, v_state, v_err, p_sql;
      END IF;
      RETURN;
  END;
  RAISE EXCEPTION '% FAIL: statement succeeded: %', p_label, p_sql;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dryrun139_expect(text, text, text, text)
  TO authenticated, anon;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
  v_sale uuid;
  v_draft uuid;
  v_result jsonb;
  v_before text;
  v_after text;
  v_ready_at timestamptz;
  v_fulfilled timestamptz;
BEGIN
  SELECT p.auth_user_id, p.role INTO v_actor, v_original_role
  FROM profiles p
  WHERE p.is_active = true AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No active owner/partner row in profiles — cannot emulate a signed-in user.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text, true);

  v_ready_at := now() - interval '10 minutes';

  INSERT INTO sales (sale_number, status, confirmed_at, fulfilled_at, subtotal, tax_total, total,
                     is_paid, kitchen_note, notes)
  VALUES ('TEST-S1S2-' || v_tag, 'confirmed', now() - interval '11 minutes', v_ready_at,
          10, 0.83, 10, true, 'no onions', 'TEST')
  RETURNING id INTO v_sale;

  INSERT INTO sales (sale_number, status)
  VALUES ('TEST-S1S2-D-' || v_tag, 'draft')
  RETURNING id INTO v_draft;

  SELECT md5(row(s.sale_number, s.status, s.confirmed_at, s.subtotal, s.tax_total, s.total,
                 s.is_paid, s.kitchen_note, s.notes, s.updated_at, s.paid_at)::text)
  INTO v_before FROM sales s WHERE id = v_sale;

  -- Act as a SELLER for A-D (the kitchen-queue role).
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;

  -- ------------------------------------------------------------------
  -- A. Seller sends a ready sale to the queue; repeat is a no-op.
  -- ------------------------------------------------------------------
  v_result := mark_sale_queued(v_sale);
  IF (v_result ->> 'changed')::boolean IS DISTINCT FROM true
     OR v_result -> 'fulfilled_at' IS DISTINCT FROM 'null'::jsonb
     OR (v_result ->> 'id')::uuid IS DISTINCT FROM v_sale THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: first call %', v_result;
  END IF;
  v_result := mark_sale_queued(v_sale);
  IF (v_result ->> 'changed')::boolean IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: repeat call %', v_result;
  END IF;

  RESET ROLE;
  SELECT fulfilled_at INTO v_fulfilled FROM sales WHERE id = v_sale;
  IF v_fulfilled IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: fulfilled_at is % after queueing', v_fulfilled;
  END IF;
  SET LOCAL ROLE authenticated;

  -- ------------------------------------------------------------------
  -- B. Seller marks it ready with the server clock; repeat is a no-op
  --    and keeps the first timestamp.
  -- ------------------------------------------------------------------
  v_result := mark_sale_fulfilled(v_sale);
  IF (v_result ->> 'changed')::boolean IS DISTINCT FROM true
     OR (v_result ->> 'fulfilled_at')::timestamptz IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: first call % (now %)', v_result, now();
  END IF;
  v_result := mark_sale_fulfilled(v_sale);
  IF (v_result ->> 'changed')::boolean IS DISTINCT FROM false
     OR (v_result ->> 'fulfilled_at')::timestamptz IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: repeat call %', v_result;
  END IF;

  -- ------------------------------------------------------------------
  -- C. Nothing but fulfilled_at changed.
  -- ------------------------------------------------------------------
  RESET ROLE;
  SELECT md5(row(s.sale_number, s.status, s.confirmed_at, s.subtotal, s.tax_total, s.total,
                 s.is_paid, s.kitchen_note, s.notes, s.updated_at, s.paid_at)::text)
  INTO v_after FROM sales s WHERE id = v_sale;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: other sale columns changed';
  END IF;
  SET LOCAL ROLE authenticated;

  -- ------------------------------------------------------------------
  -- D. Bad input: draft sale, unknown id, NULL.
  -- ------------------------------------------------------------------
  PERFORM public.dryrun139_expect('SCENARIO D1', 'P0001',
    'Only a confirmed sale can be sent to the kitchen queue (status: draft).',
    format('SELECT mark_sale_queued(%L::uuid)', v_draft));
  PERFORM public.dryrun139_expect('SCENARIO D2', 'P0001',
    'Only a confirmed sale can be marked as ready (status: draft).',
    format('SELECT mark_sale_fulfilled(%L::uuid)', v_draft));
  PERFORM public.dryrun139_expect('SCENARIO D3', 'P0001', 'Sale was not found.',
    format('SELECT mark_sale_queued(%L::uuid)', gen_random_uuid()));
  PERFORM public.dryrun139_expect('SCENARIO D4', 'P0001', 'Sale was not found.',
    format('SELECT mark_sale_fulfilled(%L::uuid)', gen_random_uuid()));
  PERFORM public.dryrun139_expect('SCENARIO D5', 'P0001', 'Sale id is required.',
    'SELECT mark_sale_queued(NULL)');
  PERFORM public.dryrun139_expect('SCENARIO D6', 'P0001', 'Sale id is required.',
    'SELECT mark_sale_fulfilled(NULL)');

  -- ------------------------------------------------------------------
  -- E. Owner/partner can use them too.
  -- ------------------------------------------------------------------
  RESET ROLE;
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  v_result := mark_sale_queued(v_sale);
  IF (v_result ->> 'changed')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: %', v_result;
  END IF;

  -- ------------------------------------------------------------------
  -- F. A signed-in user without an active profile is refused (42501),
  --    nothing changes.
  -- ------------------------------------------------------------------
  RESET ROLE;
  UPDATE profiles SET is_active = false WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;
  PERFORM public.dryrun139_expect('SCENARIO F1', '42501', 'No active profile%',
    format('SELECT mark_sale_fulfilled(%L::uuid)', v_sale));
  PERFORM public.dryrun139_expect('SCENARIO F2', '42501', 'No active profile%',
    format('SELECT mark_sale_queued(%L::uuid)', v_sale));
  RESET ROLE;
  UPDATE profiles SET is_active = true WHERE auth_user_id = v_actor;
  SELECT fulfilled_at INTO v_fulfilled FROM sales WHERE id = v_sale;
  IF v_fulfilled IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: refused call changed fulfilled_at to %', v_fulfilled;
  END IF;

  -- ------------------------------------------------------------------
  -- G. anon has no EXECUTE.
  -- ------------------------------------------------------------------
  SET LOCAL ROLE anon;
  PERFORM public.dryrun139_expect('SCENARIO G1', '42501', 'permission denied for function mark_sale_queued',
    format('SELECT mark_sale_queued(%L::uuid)', v_sale));
  PERFORM public.dryrun139_expect('SCENARIO G2', '42501', 'permission denied for function mark_sale_fulfilled',
    format('SELECT mark_sale_fulfilled(%L::uuid)', v_sale));
  RESET ROLE;

  -- ------------------------------------------------------------------
  -- H. Catalog: SECURITY DEFINER, search_path, grants.
  -- ------------------------------------------------------------------
  IF (SELECT count(*) FROM pg_proc
      WHERE oid IN ('public.mark_sale_queued(uuid)'::regprocedure,
                    'public.mark_sale_fulfilled(uuid)'::regprocedure)
        AND prosecdef AND proconfig @> ARRAY['search_path=public']) <> 2
     OR has_function_privilege('anon', 'public.mark_sale_queued(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mark_sale_fulfilled(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.mark_sale_queued(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.mark_sale_fulfilled(uuid)', 'EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
       WHERE p.oid IN ('public.mark_sale_queued(uuid)'::regprocedure,
                       'public.mark_sale_fulfilled(uuid)'::regprocedure)
         AND a.grantee = 0
     ) THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: catalog / grants wrong';
  END IF;

  RAISE NOTICE 'sql/139 dry-run: scenarios A-H passed.';
END;
$test$;

ROLLBACK;
