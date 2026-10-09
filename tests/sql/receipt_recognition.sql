-- SQL test: receipt recognition storage and line memory (sql/135).
-- Scenarios A-K. Not a migration. Always ends in ROLLBACK.
--
-- Requires the full sql/*.sql replay, including
-- sql/135_receipt_recognition.sql, plus tests/sql/bootstrap/prelude_auth.sql,
-- stub_suppliers.sql, stub_storage.sql and stub_owner_profile.sql (applied by
-- .github/workflows/sql-tests.yml job receipt-recognition, same prelude as
-- the purchase-receipts job).
--
-- Same scenarios as the dry run applied on dev and prod (09.10.2026); the
-- only difference is that the two ingredients are created here instead of
-- taken from live data. Switches SET LOCAL ROLE authenticated / anon and
-- flips the owner profile to seller and partner, all inside the
-- transaction.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/receipt_recognition.sql

BEGIN;

-- ============================================================================
-- DRY-RUN SCENARIOS A-K. Everything below runs inside the same transaction
-- and is rolled back. Any failure raises an error; a clean
-- "Success. No rows returned" means every scenario passed.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.dryrun135_expect(
  p_label text,
  p_sqlstate text,
  p_message_like text,
  p_sql text
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
      GET STACKED DIAGNOSTICS
        v_state = RETURNED_SQLSTATE,
        v_err = MESSAGE_TEXT;
      IF v_state IS DISTINCT FROM p_sqlstate OR v_err NOT ILIKE p_message_like THEN
        RAISE EXCEPTION '% FAIL: expected % [%] got % [%]',
          p_label, p_sqlstate, p_message_like, v_state, v_err;
      END IF;
      RETURN;
  END;
  RAISE EXCEPTION '% FAIL: statement succeeded: %', p_label, p_sql;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.dryrun135_expect(text, text, text, text)
  TO authenticated, anon;

DO $test$
DECLARE
  v_actor uuid;
  v_original_role text;
  v_supplier uuid;
  v_supplier_b uuid;
  v_ingredient uuid;
  v_ingredient_2 uuid;
  v_receipt uuid := gen_random_uuid();
  v_id uuid;
  v_id_2 uuid;
  v_row receipt_line_mappings%ROWTYPE;
  v_rec purchase_receipt_recognitions%ROWTYPE;
  v_matches text;
  v_count integer;
  v_tag text := right(replace(gen_random_uuid()::text, '-', ''), 12);
BEGIN
  -- --------------------------------------------------------------------
  -- Setup (as postgres): actor, two test suppliers, existing ingredients.
  -- --------------------------------------------------------------------
  SELECT p.auth_user_id, p.role
  INTO v_actor, v_original_role
  FROM profiles p
  WHERE p.is_active = true
    AND p.role IN ('owner', 'partner')
  ORDER BY CASE p.role WHEN 'owner' THEN 0 ELSE 1 END, p.auth_user_id
  LIMIT 1;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No active owner/partner row in profiles — cannot emulate a signed-in user.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated')::text,
    true
  );

  IF auth.uid() IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'auth.uid() emulation failed (got %, expected %).', auth.uid(), v_actor;
  END IF;

  INSERT INTO suppliers (code, name, is_active)
  VALUES ('T135A' || v_tag, 'TEST_RCPT_135_A_' || v_tag, true)
  RETURNING id INTO v_supplier;

  INSERT INTO suppliers (code, name, is_active)
  VALUES ('T135B' || v_tag, 'TEST_RCPT_135_B_' || v_tag, true)
  RETURNING id INTO v_supplier_b;

  INSERT INTO ingredients (name, unit)
  VALUES ('TEST_135_ING_A_' || v_tag, 'L')
  RETURNING id INTO v_ingredient;

  INSERT INTO ingredients (name, unit)
  VALUES ('TEST_135_ING_B_' || v_tag, 'kg')
  RETURNING id INTO v_ingredient_2;

  IF v_ingredient IS NULL OR v_ingredient_2 IS NULL THEN
    RAISE EXCEPTION 'SETUP FAIL: need at least two ingredients.';
  END IF;

  SET LOCAL ROLE authenticated;

  IF get_my_role() IS NULL OR get_my_role() NOT IN ('owner', 'partner') THEN
    RAISE EXCEPTION 'SETUP FAIL: get_my_role() is %', get_my_role();
  END IF;

  -- --------------------------------------------------------------------
  -- A. Normalizer.
  -- --------------------------------------------------------------------
  IF receipt_line_text_key('  Melk HALFV. 1L ') IS DISTINCT FROM 'melk halfv 1l'
     OR receipt_line_text_key('KIPFILET*500G--') IS DISTINCT FROM 'kipfilet 500g'
     OR receipt_line_text_key(' *** ') IS NOT NULL
     OR receipt_line_text_key('') IS NOT NULL
     OR receipt_line_text_key(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: normalizer returned [%] [%] [%]',
      receipt_line_text_key('  Melk HALFV. 1L '),
      receipt_line_text_key('KIPFILET*500G--'),
      receipt_line_text_key(' *** ');
  END IF;

  -- --------------------------------------------------------------------
  -- B. Remember an ingredient line; same text in another spelling
  --    replaces the same row (now as skip).
  -- --------------------------------------------------------------------
  v_id := remember_receipt_line_mapping(v_supplier, '  Melk   HALFV. 1L ', 'Ingredient', v_ingredient, 6.00004);

  SELECT * INTO v_row FROM receipt_line_mappings WHERE id = v_id;
  IF NOT FOUND
     OR v_row.supplier_id IS DISTINCT FROM v_supplier
     OR v_row.text_key IS DISTINCT FROM 'melk halfv 1l'
     OR v_row.receipt_text IS DISTINCT FROM 'Melk HALFV. 1L'
     OR v_row.action IS DISTINCT FROM 'ingredient'
     OR v_row.ingredient_id IS DISTINCT FROM v_ingredient
     OR v_row.units_per_item IS DISTINCT FROM 6.0000
     OR v_row.created_by IS DISTINCT FROM v_actor
     OR v_row.updated_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'SCENARIO B1 FAIL: row %', row_to_json(v_row);
  END IF;

  v_id_2 := remember_receipt_line_mapping(v_supplier, 'MELK halfv 1L!', 'skip', NULL, NULL);
  IF v_id_2 IS DISTINCT FROM v_id THEN
    RAISE EXCEPTION 'SCENARIO B2 FAIL: second call created another row (% vs %)', v_id_2, v_id;
  END IF;

  SELECT * INTO v_row FROM receipt_line_mappings WHERE id = v_id;
  IF v_row.action IS DISTINCT FROM 'skip'
     OR v_row.ingredient_id IS NOT NULL
     OR v_row.units_per_item IS NOT NULL
     OR v_row.receipt_text IS DISTINCT FROM 'MELK halfv 1L!' THEN
    RAISE EXCEPTION 'SCENARIO B2 FAIL: row %', row_to_json(v_row);
  END IF;

  SELECT count(*) INTO v_count FROM receipt_line_mappings WHERE supplier_id = v_supplier;
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SCENARIO B2 FAIL: % rows for the supplier', v_count;
  END IF;

  -- Back to an ingredient with a different one.
  PERFORM remember_receipt_line_mapping(v_supplier, 'melk halfv 1l', 'ingredient', v_ingredient_2, 1);
  SELECT * INTO v_row FROM receipt_line_mappings WHERE id = v_id;
  IF v_row.action IS DISTINCT FROM 'ingredient'
     OR v_row.ingredient_id IS DISTINCT FROM v_ingredient_2
     OR v_row.units_per_item IS DISTINCT FROM 1.0000 THEN
    RAISE EXCEPTION 'SCENARIO B3 FAIL: row %', row_to_json(v_row);
  END IF;

  -- --------------------------------------------------------------------
  -- C. Validation messages; nothing written by refused calls.
  -- --------------------------------------------------------------------
  PERFORM public.dryrun135_expect('SCENARIO C1', 'P0001', 'A supplier is required.',
    format('SELECT remember_receipt_line_mapping(NULL, ''x'', ''skip'', NULL, NULL)'));
  PERFORM public.dryrun135_expect('SCENARIO C2', 'P0001', 'Receipt line text is required.',
    format('SELECT remember_receipt_line_mapping(%L::uuid, '' *** '', ''skip'', NULL, NULL)', v_supplier));
  PERFORM public.dryrun135_expect('SCENARIO C3', 'P0001', 'Receipt line text is too long.',
    format('SELECT remember_receipt_line_mapping(%L::uuid, %L, ''skip'', NULL, NULL)', v_supplier, repeat('a', 201)));
  PERFORM public.dryrun135_expect('SCENARIO C4', 'P0001', 'Action must be ingredient or skip.',
    format('SELECT remember_receipt_line_mapping(%L::uuid, ''bag'', ''ignore'', NULL, NULL)', v_supplier));
  PERFORM public.dryrun135_expect('SCENARIO C5', 'P0001', 'Choose an ingredient.',
    format('SELECT remember_receipt_line_mapping(%L::uuid, ''bag'', ''ingredient'', NULL, 1)', v_supplier));
  PERFORM public.dryrun135_expect('SCENARIO C6', 'P0001', 'Ingredient not found.',
    format('SELECT remember_receipt_line_mapping(%L::uuid, ''bag'', ''ingredient'', %L::uuid, 1)', v_supplier, gen_random_uuid()));
  PERFORM public.dryrun135_expect('SCENARIO C7', 'P0001', 'Units per receipt item must be greater than 0.',
    format('SELECT remember_receipt_line_mapping(%L::uuid, ''bag'', ''ingredient'', %L::uuid, 0)', v_supplier, v_ingredient));
  PERFORM public.dryrun135_expect('SCENARIO C8', 'P0001', 'Units per receipt item must be between 0.0001 and 100000.',
    format('SELECT remember_receipt_line_mapping(%L::uuid, ''bag'', ''ingredient'', %L::uuid, 0.00001)', v_supplier, v_ingredient));
  PERFORM public.dryrun135_expect('SCENARIO C9', 'P0001', 'Units per receipt item must be between 0.0001 and 100000.',
    format('SELECT remember_receipt_line_mapping(%L::uuid, ''bag'', ''ingredient'', %L::uuid, 100001)', v_supplier, v_ingredient));
  PERFORM public.dryrun135_expect('SCENARIO C10', 'P0001', 'A skipped line has no ingredient.',
    format('SELECT remember_receipt_line_mapping(%L::uuid, ''bag'', ''skip'', %L::uuid, NULL)', v_supplier, v_ingredient));
  PERFORM public.dryrun135_expect('SCENARIO C11', 'P0001', 'A skipped line has no ingredient.',
    format('SELECT remember_receipt_line_mapping(%L::uuid, ''bag'', ''skip'', NULL, 2)', v_supplier));

  SELECT count(*) INTO v_count FROM receipt_line_mappings WHERE supplier_id = v_supplier;
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: refused calls wrote rows (% rows)', v_count;
  END IF;

  -- --------------------------------------------------------------------
  -- D. Matching: input order kept, unknown and empty texts come back
  --    with NULLs, other supplier sees nothing.
  -- --------------------------------------------------------------------
  PERFORM remember_receipt_line_mapping(v_supplier, 'DRAAGTAS', 'skip', NULL, NULL);

  SELECT string_agg(
           line_index || ':' || coalesce(text_key, '<null>') || ':' || coalesce(action, '<null>')
             || ':' || coalesce((ingredient_id = v_ingredient_2)::text, '<null>')
             || ':' || coalesce(units_per_item::text, '<null>'),
           ' | ' ORDER BY line_index)
  INTO v_matches
  FROM match_receipt_lines(v_supplier, ARRAY['Melk Halfv 1L', 'Unknown thing', NULL, 'draagtas.']);

  IF v_matches IS DISTINCT FROM
       '1:melk halfv 1l:ingredient:true:1.0000 | 2:unknown thing:<null>:<null>:<null> | '
       || '3:<null>:<null>:<null>:<null> | 4:draagtas:skip:<null>:<null>' THEN
    RAISE EXCEPTION 'SCENARIO D1 FAIL: [%]', v_matches;
  END IF;

  SELECT count(*) INTO v_count
  FROM match_receipt_lines(v_supplier_b, ARRAY['Melk Halfv 1L', 'DRAAGTAS'])
  WHERE action IS NOT NULL;
  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'SCENARIO D2 FAIL: other supplier matched % lines', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM match_receipt_lines(v_supplier, NULL);
  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'SCENARIO D3 FAIL: NULL input returned % rows', v_count;
  END IF;

  PERFORM public.dryrun135_expect('SCENARIO D4', 'P0001', 'At most 200 receipt lines can be matched at once.',
    format('SELECT * FROM match_receipt_lines(%L::uuid, array_fill(''x''::text, ARRAY[201]))', v_supplier));

  -- --------------------------------------------------------------------
  -- E. Direct writes on the memory table.
  -- --------------------------------------------------------------------
  PERFORM public.dryrun135_expect('SCENARIO E1', '23514', '%receipt_line_mappings_%text%_check%',
    format('INSERT INTO receipt_line_mappings (supplier_id, text_key, receipt_text, action) VALUES (%L::uuid, ''Raw Text'', ''Raw Text'', ''skip'')', v_supplier));
  PERFORM public.dryrun135_expect('SCENARIO E2', '23514', '%receipt_line_mappings_receipt_text_check%',
    format('INSERT INTO receipt_line_mappings (supplier_id, text_key, receipt_text, action) VALUES (%L::uuid, ''abc'', ''xyz'', ''skip'')', v_supplier));
  PERFORM public.dryrun135_expect('SCENARIO E3', '23514', '%receipt_line_mappings_action_fields_check%',
    format('INSERT INTO receipt_line_mappings (supplier_id, text_key, receipt_text, action) VALUES (%L::uuid, ''abc'', ''ABC'', ''ingredient'')', v_supplier));
  PERFORM public.dryrun135_expect('SCENARIO E4', '42501', 'permission denied%',
    format('UPDATE receipt_line_mappings SET text_key = ''other'' WHERE id = %L::uuid', v_id));
  PERFORM public.dryrun135_expect('SCENARIO E5', '42501', 'permission denied%',
    format('UPDATE receipt_line_mappings SET updated_by = %L::uuid WHERE id = %L::uuid', gen_random_uuid(), v_id));
  PERFORM public.dryrun135_expect('SCENARIO E6', '42501', 'permission denied%',
    format('DELETE FROM receipt_line_mappings WHERE id = %L::uuid', v_id));
  PERFORM public.dryrun135_expect('SCENARIO E7', '42501', 'permission denied%',
    format('INSERT INTO receipt_line_mappings (supplier_id, text_key, receipt_text, action, created_by) VALUES (%L::uuid, ''abc'', ''ABC'', ''skip'', %L::uuid)', v_supplier, gen_random_uuid()));

  -- An allowed direct update still stamps updated_by.
  UPDATE receipt_line_mappings SET receipt_text = 'Melk halfv 1L' WHERE id = v_id;
  SELECT * INTO v_row FROM receipt_line_mappings WHERE id = v_id;
  IF v_row.updated_by IS DISTINCT FROM v_actor OR v_row.receipt_text IS DISTINCT FROM 'Melk halfv 1L' THEN
    RAISE EXCEPTION 'SCENARIO E8 FAIL: row %', row_to_json(v_row);
  END IF;

  -- --------------------------------------------------------------------
  -- F. Recognitions: insert-only, shape rules.
  -- --------------------------------------------------------------------
  INSERT INTO purchase_receipts (id, receipt_date) VALUES (v_receipt, DATE '2026-10-09');

  INSERT INTO purchase_receipt_recognitions (receipt_id, status, model, result, input_tokens, output_tokens)
  VALUES (v_receipt, 'succeeded', 'test-model', '{"lines": []}'::jsonb, 100, 20)
  RETURNING * INTO v_rec;

  IF v_rec.created_by IS DISTINCT FROM v_actor OR v_rec.error IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO F1 FAIL: row %', row_to_json(v_rec);
  END IF;

  INSERT INTO purchase_receipt_recognitions (receipt_id, status, model, error)
  VALUES (v_receipt, 'failed', 'test-model', 'The receipt could not be read.');

  PERFORM public.dryrun135_expect('SCENARIO F2', '23514', '%purchase_receipt_recognitions_result_check%',
    format('INSERT INTO purchase_receipt_recognitions (receipt_id, status, model) VALUES (%L::uuid, ''succeeded'', ''m'')', v_receipt));
  PERFORM public.dryrun135_expect('SCENARIO F3', '23514', '%purchase_receipt_recognitions_error_check%',
    format('INSERT INTO purchase_receipt_recognitions (receipt_id, status, model) VALUES (%L::uuid, ''failed'', ''m'')', v_receipt));
  PERFORM public.dryrun135_expect('SCENARIO F4', '23514', '%purchase_receipt_recognitions_result_shape_check%',
    format('INSERT INTO purchase_receipt_recognitions (receipt_id, status, model, result) VALUES (%L::uuid, ''succeeded'', ''m'', ''[1,2]''::jsonb)', v_receipt));
  PERFORM public.dryrun135_expect('SCENARIO F5', '23514', '%purchase_receipt_recognitions_status_check%',
    format('INSERT INTO purchase_receipt_recognitions (receipt_id, status, model) VALUES (%L::uuid, ''done'', ''m'')', v_receipt));
  PERFORM public.dryrun135_expect('SCENARIO F6', '42501', 'permission denied%',
    format('UPDATE purchase_receipt_recognitions SET model = ''x'' WHERE id = %L::uuid', v_rec.id));
  PERFORM public.dryrun135_expect('SCENARIO F7', '42501', 'permission denied%',
    format('DELETE FROM purchase_receipt_recognitions WHERE id = %L::uuid', v_rec.id));
  PERFORM public.dryrun135_expect('SCENARIO F8', '42501', 'permission denied%',
    format('INSERT INTO purchase_receipt_recognitions (receipt_id, status, model, result, created_by) VALUES (%L::uuid, ''succeeded'', ''m'', ''{}''::jsonb, %L::uuid)', v_receipt, gen_random_uuid()));

  SELECT count(*) INTO v_count FROM purchase_receipt_recognitions WHERE receipt_id = v_receipt;
  IF v_count IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: % recognition rows (expected 2)', v_count;
  END IF;

  -- --------------------------------------------------------------------
  -- G. Seller: no access to anything here.
  -- --------------------------------------------------------------------
  RESET ROLE;
  UPDATE profiles SET role = 'seller' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'SETUP FAIL: role switch to seller did not apply (%).', get_my_role();
  END IF;

  PERFORM public.dryrun135_expect('SCENARIO G1', '42501', 'Insufficient permissions%',
    format('SELECT remember_receipt_line_mapping(%L::uuid, ''x'', ''skip'', NULL, NULL)', v_supplier));
  PERFORM public.dryrun135_expect('SCENARIO G2', '42501', 'Insufficient permissions%',
    format('SELECT * FROM match_receipt_lines(%L::uuid, ARRAY[''x''])', v_supplier));
  PERFORM public.dryrun135_expect('SCENARIO G3', '42501', 'new row violates row-level security%',
    format('INSERT INTO receipt_line_mappings (supplier_id, text_key, receipt_text, action) VALUES (%L::uuid, ''seller'', ''seller'', ''skip'')', v_supplier));
  PERFORM public.dryrun135_expect('SCENARIO G4', '42501', 'new row violates row-level security%',
    format('INSERT INTO purchase_receipt_recognitions (receipt_id, status, model, result) VALUES (%L::uuid, ''succeeded'', ''m'', ''{}''::jsonb)', v_receipt));

  SELECT (SELECT count(*) FROM receipt_line_mappings)
       + (SELECT count(*) FROM purchase_receipt_recognitions)
  INTO v_count;
  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'SCENARIO G5 FAIL: seller sees % rows', v_count;
  END IF;

  UPDATE receipt_line_mappings SET receipt_text = 'seller' WHERE id = v_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'SCENARIO G6 FAIL: seller updated % rows', v_count;
  END IF;

  -- --------------------------------------------------------------------
  -- H. Partner: full access.
  -- --------------------------------------------------------------------
  RESET ROLE;
  UPDATE profiles SET role = 'partner' WHERE auth_user_id = v_actor;
  SET LOCAL ROLE authenticated;

  v_id_2 := remember_receipt_line_mapping(v_supplier_b, 'Kipfilet 500g', 'ingredient', v_ingredient, 2);
  SELECT count(*) INTO v_count
  FROM match_receipt_lines(v_supplier_b, ARRAY['KIPFILET 500G'])
  WHERE action = 'ingredient' AND units_per_item = 2;
  IF v_id_2 IS NULL OR v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: partner remember/match (id %, matched %)', v_id_2, v_count;
  END IF;

  -- --------------------------------------------------------------------
  -- J. anon: no table or function access.
  -- --------------------------------------------------------------------
  RESET ROLE;
  UPDATE profiles SET role = v_original_role WHERE auth_user_id = v_actor;
  SET LOCAL ROLE anon;

  PERFORM public.dryrun135_expect('SCENARIO J1', '42501', 'permission denied%',
    'SELECT count(*) FROM receipt_line_mappings');
  PERFORM public.dryrun135_expect('SCENARIO J2', '42501', 'permission denied%',
    'SELECT count(*) FROM purchase_receipt_recognitions');
  PERFORM public.dryrun135_expect('SCENARIO J3', '42501', 'permission denied%',
    format('SELECT remember_receipt_line_mapping(%L::uuid, ''x'', ''skip'', NULL, NULL)', v_supplier));
  PERFORM public.dryrun135_expect('SCENARIO J4', '42501', 'permission denied%',
    format('SELECT * FROM match_receipt_lines(%L::uuid, ARRAY[''x''])', v_supplier));

  RESET ROLE;

  -- --------------------------------------------------------------------
  -- K. Catalog: invoker functions, grant shape, no DELETE anywhere.
  -- --------------------------------------------------------------------
  IF EXISTS (
       SELECT 1 FROM pg_proc
       WHERE proname IN ('remember_receipt_line_mapping', 'match_receipt_lines',
                         'receipt_line_text_key', 'receipt_line_mappings_touch')
         AND pronamespace = 'public'::regnamespace
         AND prosecdef
     ) THEN
    RAISE EXCEPTION 'SCENARIO K1 FAIL: a new function is SECURITY DEFINER';
  END IF;

  IF has_function_privilege('anon', 'remember_receipt_line_mapping(uuid, text, text, uuid, numeric)', 'EXECUTE')
     OR has_function_privilege('anon', 'match_receipt_lines(uuid, text[])', 'EXECUTE')
     OR has_function_privilege('anon', 'receipt_line_text_key(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'remember_receipt_line_mapping(uuid, text, text, uuid, numeric)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'match_receipt_lines(uuid, text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'SCENARIO K2 FAIL: function grants are wrong';
  END IF;

  IF has_table_privilege('authenticated', 'receipt_line_mappings', 'DELETE')
     OR has_table_privilege('authenticated', 'purchase_receipt_recognitions', 'DELETE')
     OR has_table_privilege('authenticated', 'purchase_receipt_recognitions', 'UPDATE')
     OR has_table_privilege('anon', 'receipt_line_mappings', 'SELECT')
     OR has_table_privilege('anon', 'purchase_receipt_recognitions', 'SELECT')
     OR has_column_privilege('authenticated', 'receipt_line_mappings', 'created_by', 'INSERT')
     OR has_column_privilege('authenticated', 'receipt_line_mappings', 'updated_by', 'UPDATE')
     OR has_column_privilege('authenticated', 'receipt_line_mappings', 'supplier_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'purchase_receipt_recognitions', 'created_by', 'INSERT') THEN
    RAISE EXCEPTION 'SCENARIO K3 FAIL: table grants are wrong';
  END IF;

  IF EXISTS (
       SELECT 1 FROM pg_policies
       WHERE tablename IN ('receipt_line_mappings', 'purchase_receipt_recognitions')
         AND (cmd IN ('DELETE', 'ALL')
              OR (tablename = 'purchase_receipt_recognitions' AND cmd = 'UPDATE'))
     ) THEN
    RAISE EXCEPTION 'SCENARIO K4 FAIL: unexpected DELETE/UPDATE/ALL policy';
  END IF;

  RAISE NOTICE 'sql/135 dry run: all scenarios passed';
END;
$test$;

ROLLBACK;
