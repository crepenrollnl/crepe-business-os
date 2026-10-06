-- SQL test: create_purchase_receipt (sql/134).
-- Scenarios A-I. Not a migration. Always ends in ROLLBACK.
--
-- Requires the full sql/*.sql replay, including sql/133 and sql/134, plus
-- tests/sql/bootstrap/prelude_auth.sql, stub_suppliers.sql, stub_storage.sql,
-- and stub_owner_profile.sql (job create-purchase-receipt).
--
-- The CI storage stub creates storage.objects and enables RLS, but it does
-- not GRANT USAGE on schema storage or SELECT on storage.objects to
-- authenticated. Hosted Supabase does. Those two grants live only in this
-- rolled-back test. prelude_auth also omits USAGE on schema auth.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/create_purchase_receipt.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.expect_create_receipt_sqlstate(
  p_label text,
  p_sqlstate text,
  p_sql text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_sqlstate text;
  v_err text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION '% FAIL: statement succeeded', p_label;
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_err = MESSAGE_TEXT;
      IF v_err LIKE p_label || ' FAIL:%' THEN
        RAISE;
      END IF;
      IF v_sqlstate IS DISTINCT FROM p_sqlstate THEN
        RAISE EXCEPTION '% FAIL: expected % got % (%)',
          p_label, p_sqlstate, v_sqlstate, v_err;
      END IF;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.expect_create_receipt_sqlstate(text, text, text)
  TO authenticated;

DO $test$
DECLARE
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_seller uuid := '00000000-0000-4000-8000-000000000134';
  v_role text;
  v_claims text;
  v_supplier uuid;
  v_receipt uuid := '10000000-0000-4000-8000-0000000000a1';
  v_heic uuid := '10000000-0000-4000-8000-0000000000c3';
  v_twice uuid := '10000000-0000-4000-8000-0000000000d4';
  v_negative uuid := '10000000-0000-4000-8000-0000000000e5';
  v_nulls uuid := '10000000-0000-4000-8000-0000000000f6';
  v_empty uuid := '10000000-0000-4000-8000-0000000000a7';
  v_nonarray uuid := '10000000-0000-4000-8000-0000000000a8';
  v_eleven uuid := '10000000-0000-4000-8000-0000000000a9';
  v_badpath uuid := '10000000-0000-4000-8000-0000000000aa';
  v_missing uuid := '10000000-0000-4000-8000-0000000000ab';
  v_seller_receipt uuid := '10000000-0000-4000-8000-0000000000ac';
  v_returned uuid;
  v_created_by uuid;
  v_note text;
  v_total numeric;
  v_supplier_id uuid;
  v_page integer;
  v_path text;
  v_count integer;
  v_files jsonb;
  v_i integer;
  v_err text;
  v_sqlstate text;
  v_prosecdef boolean;
  v_anon boolean;
  v_authenticated boolean;
  v_public boolean;
BEGIN
  SELECT role
  INTO v_role
  FROM profiles
  WHERE auth_user_id = v_owner
    AND is_active = true;

  IF v_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: stub owner missing or not owner (role %)',
      v_role;
  END IF;

  INSERT INTO auth.users (id, email)
  VALUES (v_seller, 'sql-replay-stub-seller-134@example.invalid');

  INSERT INTO profiles (auth_user_id, role, is_active)
  VALUES (v_seller, 'seller', true);

  INSERT INTO suppliers (code, name, is_active)
  VALUES ('T134RCPT', 'TEST_RCPT_134_supplier', true)
  RETURNING id INTO v_supplier;

  IF v_supplier IS NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: supplier was not inserted';
  END IF;

  -- CI stub: schema storage and storage.objects exist, with no privileges
  -- for authenticated. Live Supabase grants both.
  GRANT USAGE ON SCHEMA storage TO authenticated;
  GRANT SELECT ON TABLE storage.objects TO authenticated;
  GRANT USAGE ON SCHEMA auth TO authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

  INSERT INTO storage.objects (bucket_id, name) VALUES
    ('purchase-receipts', v_receipt::text || '/a.jpg'),
    ('purchase-receipts', v_receipt::text || '/b.jpg'),
    ('purchase-receipts', v_heic::text || '/ok.jpg'),
    ('purchase-receipts', v_heic::text || '/bad.jpg'),
    ('purchase-receipts', v_twice::text || '/only.jpg'),
    ('purchase-receipts', v_negative::text || '/only.jpg'),
    ('purchase-receipts', v_nulls::text || '/only.jpg'),
    ('purchase-receipts', 'other-receipt/file.jpg');

  v_claims := json_build_object(
    'sub', v_owner::text,
    'role', 'authenticated'
  )::text;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);
  SET LOCAL ROLE authenticated;

  IF current_user IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: current_user is %', current_user;
  END IF;
  IF auth.uid() IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: auth.uid() is %', auth.uid();
  END IF;
  IF get_my_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: get_my_role() is %', get_my_role();
  END IF;

  -- A. Two pages, array order, caller, trimmed note, rounded total.
  v_returned := create_purchase_receipt(
    v_receipt,
    DATE '2026-10-05',
    v_supplier,
    10.126,
    '  Market run  ',
    jsonb_build_array(
      jsonb_build_object(
        'storage_path', v_receipt::text || '/a.jpg',
        'mime_type', 'image/jpeg',
        'size_bytes', 1200,
        'original_filename', 'a.jpg'
      ),
      jsonb_build_object(
        'storage_path', v_receipt::text || '/b.jpg',
        'mime_type', 'image/png',
        'size_bytes', 2400,
        'original_filename', '  '
      )
    )
  );

  IF v_returned IS DISTINCT FROM v_receipt THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: returned %', v_returned;
  END IF;

  SELECT created_by, note, receipt_total, supplier_id
  INTO v_created_by, v_note, v_total, v_supplier_id
  FROM purchase_receipts
  WHERE id = v_receipt;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: receipt row is missing';
  END IF;
  IF v_created_by IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: created_by %', v_created_by;
  END IF;
  IF v_note IS DISTINCT FROM 'Market run' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: note [%]', v_note;
  END IF;
  IF v_total IS DISTINCT FROM 10.13 THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: total %', v_total;
  END IF;
  IF v_supplier_id IS DISTINCT FROM v_supplier THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: supplier %', v_supplier_id;
  END IF;

  SELECT page_number, storage_path, created_by
  INTO v_page, v_path, v_created_by
  FROM purchase_receipt_files
  WHERE receipt_id = v_receipt
  ORDER BY page_number
  LIMIT 1;

  IF v_page IS DISTINCT FROM 1
     OR v_path IS DISTINCT FROM v_receipt::text || '/a.jpg'
     OR v_created_by IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: page 1 number=% path=% created_by=%',
      v_page, v_path, v_created_by;
  END IF;

  SELECT page_number, storage_path, original_filename, created_by
  INTO v_page, v_path, v_note, v_created_by
  FROM purchase_receipt_files
  WHERE receipt_id = v_receipt
    AND page_number = 2;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: page 2 is missing';
  END IF;
  IF v_path IS DISTINCT FROM v_receipt::text || '/b.jpg' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: page 2 path %', v_path;
  END IF;
  IF v_note IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: blank filename stored as [%]', v_note;
  END IF;
  IF v_created_by IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: page 2 created_by %', v_created_by;
  END IF;

  SELECT count(*) INTO v_count
  FROM purchase_receipt_files
  WHERE receipt_id = v_receipt;

  IF v_count IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: file count %', v_count;
  END IF;

  RAISE NOTICE 'SCENARIO A PASS';

  -- B. Seller is refused and no row is written.
  RESET ROLE;
  v_claims := json_build_object(
    'sub', v_seller::text,
    'role', 'authenticated'
  )::text;
  PERFORM set_config('request.jwt.claim.sub', v_seller::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);
  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: get_my_role() is %', get_my_role();
  END IF;

  BEGIN
    PERFORM create_purchase_receipt(
      v_seller_receipt,
      DATE '2026-10-05',
      NULL,
      NULL,
      NULL,
      jsonb_build_array(
        jsonb_build_object(
          'storage_path', v_seller_receipt::text || '/a.jpg',
          'mime_type', 'image/jpeg',
          'size_bytes', 100
        )
      )
    );
    RAISE EXCEPTION 'SCENARIO B FAIL: seller call succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO B FAIL:%' THEN
        RAISE;
      END IF;
      IF v_sqlstate IS DISTINCT FROM '42501'
         OR v_err NOT LIKE '%Insufficient permissions for this action (role: seller).%' THEN
        RAISE EXCEPTION 'SCENARIO B FAIL: sqlstate % message %', v_sqlstate, v_err;
      END IF;
  END;

  SELECT count(*) INTO v_count
  FROM purchase_receipts
  WHERE id = v_seller_receipt;

  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: seller wrote % receipts', v_count;
  END IF;

  RAISE NOTICE 'SCENARIO B PASS';

  -- C–H continue as the owner.
  RESET ROLE;
  v_claims := json_build_object(
    'sub', v_owner::text,
    'role', 'authenticated'
  )::text;
  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);
  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: get_my_role() is %', get_my_role();
  END IF;

  -- C. Empty array, non-array, 11 files.
  PERFORM public.expect_create_receipt_sqlstate(
    'SCENARIO C',
    'P0001',
    format(
      $q$SELECT create_purchase_receipt(%L::uuid, DATE '2026-10-05', NULL, NULL, NULL, '[]'::jsonb)$q$,
      v_empty
    )
  );

  BEGIN
    PERFORM create_purchase_receipt(
      v_empty,
      DATE '2026-10-05',
      NULL,
      NULL,
      NULL,
      '[]'::jsonb
    );
    RAISE EXCEPTION 'SCENARIO C FAIL: empty array succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO C FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%Add at least one photo.%' THEN
        RAISE EXCEPTION 'SCENARIO C FAIL: empty message %', v_err;
      END IF;
  END;

  BEGIN
    PERFORM create_purchase_receipt(
      v_nonarray,
      DATE '2026-10-05',
      NULL,
      NULL,
      NULL,
      '{"storage_path":"x"}'::jsonb
    );
    RAISE EXCEPTION 'SCENARIO C FAIL: non-array succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO C FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%Receipt photos must be a list.%' THEN
        RAISE EXCEPTION 'SCENARIO C FAIL: non-array message %', v_err;
      END IF;
  END;

  v_files := '[]'::jsonb;
  FOR v_i IN 1..11 LOOP
    v_files := v_files || jsonb_build_array(
      jsonb_build_object(
        'storage_path', v_eleven::text || '/' || v_i::text || '.jpg',
        'mime_type', 'image/jpeg',
        'size_bytes', 100
      )
    );
  END LOOP;

  IF jsonb_array_length(v_files) IS DISTINCT FROM 11 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: built % files', jsonb_array_length(v_files);
  END IF;

  BEGIN
    PERFORM create_purchase_receipt(
      v_eleven,
      DATE '2026-10-05',
      NULL,
      NULL,
      NULL,
      v_files
    );
    RAISE EXCEPTION 'SCENARIO C FAIL: 11 files succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO C FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%A receipt can have at most 10 photos.%' THEN
        RAISE EXCEPTION 'SCENARIO C FAIL: 11-file message %', v_err;
      END IF;
  END;

  SELECT count(*) INTO v_count
  FROM purchase_receipts
  WHERE id IN (v_empty, v_nonarray, v_eleven);

  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: refused calls wrote % rows', v_count;
  END IF;

  RAISE NOTICE 'SCENARIO C PASS';

  -- D. Path does not start with the receipt id. The object exists, so a
  -- missing-upload check must not be what refuses the call.
  BEGIN
    PERFORM create_purchase_receipt(
      v_badpath,
      DATE '2026-10-05',
      NULL,
      NULL,
      NULL,
      jsonb_build_array(
        jsonb_build_object(
          'storage_path', 'other-receipt/file.jpg',
          'mime_type', 'image/jpeg',
          'size_bytes', 100
        )
      )
    );
    RAISE EXCEPTION 'SCENARIO D FAIL: foreign path succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO D FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%Photo storage path must belong to this receipt.%' THEN
        RAISE EXCEPTION 'SCENARIO D FAIL: message %', v_err;
      END IF;
  END;

  SELECT count(*) INTO v_count
  FROM purchase_receipts
  WHERE id = v_badpath;

  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: row was written';
  END IF;

  RAISE NOTICE 'SCENARIO D PASS';

  -- E. Path is shaped correctly and has no storage object.
  BEGIN
    PERFORM create_purchase_receipt(
      v_missing,
      DATE '2026-10-05',
      NULL,
      NULL,
      NULL,
      jsonb_build_array(
        jsonb_build_object(
          'storage_path', v_missing::text || '/missing.jpg',
          'mime_type', 'image/jpeg',
          'size_bytes', 100
        )
      )
    );
    RAISE EXCEPTION 'SCENARIO E FAIL: missing object succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO E FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err IS DISTINCT FROM 'Receipt photo was not uploaded. Try again.' THEN
        RAISE EXCEPTION 'SCENARIO E FAIL: message [%]', v_err;
      END IF;
  END;

  SELECT count(*) INTO v_count
  FROM purchase_receipts
  WHERE id = v_missing;

  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: row was written';
  END IF;

  RAISE NOTICE 'SCENARIO E PASS';

  -- F. Second page is HEIC. The receipt insert must roll back with the call.
  BEGIN
    PERFORM create_purchase_receipt(
      v_heic,
      DATE '2026-10-05',
      NULL,
      NULL,
      NULL,
      jsonb_build_array(
        jsonb_build_object(
          'storage_path', v_heic::text || '/ok.jpg',
          'mime_type', 'image/jpeg',
          'size_bytes', 100
        ),
        jsonb_build_object(
          'storage_path', v_heic::text || '/bad.jpg',
          'mime_type', 'image/heic',
          'size_bytes', 100
        )
      )
    );
    RAISE EXCEPTION 'SCENARIO F FAIL: heic call succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO F FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%Photo type must be JPEG, PNG, or WebP.%' THEN
        RAISE EXCEPTION 'SCENARIO F FAIL: message %', v_err;
      END IF;
  END;

  SELECT count(*) INTO v_count
  FROM purchase_receipts
  WHERE id = v_heic;

  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: receipt row remains';
  END IF;

  SELECT count(*) INTO v_count
  FROM purchase_receipt_files
  WHERE receipt_id = v_heic;

  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: file rows remain (%)', v_count;
  END IF;

  RAISE NOTICE 'SCENARIO F PASS';

  -- G. Second call with the same id fails. The first receipt stays.
  v_returned := create_purchase_receipt(
    v_twice,
    DATE '2026-10-05',
    NULL,
    4,
    'first note',
    jsonb_build_array(
      jsonb_build_object(
        'storage_path', v_twice::text || '/only.jpg',
        'mime_type', 'image/jpeg',
        'size_bytes', 100
      )
    )
  );

  IF v_returned IS DISTINCT FROM v_twice THEN
    RAISE EXCEPTION 'SCENARIO G FAIL: first call returned %', v_returned;
  END IF;

  BEGIN
    PERFORM create_purchase_receipt(
      v_twice,
      DATE '2026-10-06',
      v_supplier,
      99,
      'second note',
      jsonb_build_array(
        jsonb_build_object(
          'storage_path', v_twice::text || '/only.jpg',
          'mime_type', 'image/jpeg',
          'size_bytes', 100
        )
      )
    );
    RAISE EXCEPTION 'SCENARIO G FAIL: second call succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS
        v_sqlstate = RETURNED_SQLSTATE,
        v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO G FAIL:%' THEN
        RAISE;
      END IF;
      IF v_sqlstate IS DISTINCT FROM '23505' THEN
        RAISE EXCEPTION 'SCENARIO G FAIL: sqlstate % message %', v_sqlstate, v_err;
      END IF;
  END;

  SELECT note, receipt_total, receipt_date::text
  INTO v_note, v_total, v_path
  FROM purchase_receipts
  WHERE id = v_twice;

  IF v_note IS DISTINCT FROM 'first note'
     OR v_total IS DISTINCT FROM 4.00
     OR v_path IS DISTINCT FROM '2026-10-05' THEN
    RAISE EXCEPTION
      'SCENARIO G FAIL: first receipt changed note=% total=% date=%',
      v_note, v_total, v_path;
  END IF;

  SELECT count(*) INTO v_count
  FROM purchase_receipt_files
  WHERE receipt_id = v_twice;

  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SCENARIO G FAIL: file count %', v_count;
  END IF;

  RAISE NOTICE 'SCENARIO G PASS';

  -- H. Negative total is refused. Null supplier, total, and note are accepted.
  BEGIN
    PERFORM create_purchase_receipt(
      v_negative,
      DATE '2026-10-05',
      NULL,
      -0.01,
      NULL,
      jsonb_build_array(
        jsonb_build_object(
          'storage_path', v_negative::text || '/only.jpg',
          'mime_type', 'image/jpeg',
          'size_bytes', 100
        )
      )
    );
    RAISE EXCEPTION 'SCENARIO H FAIL: negative total succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      IF v_err LIKE 'SCENARIO H FAIL:%' THEN
        RAISE;
      END IF;
      IF v_err NOT LIKE '%Receipt total cannot be negative.%' THEN
        RAISE EXCEPTION 'SCENARIO H FAIL: message %', v_err;
      END IF;
  END;

  SELECT count(*) INTO v_count
  FROM purchase_receipts
  WHERE id = v_negative;

  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: negative total wrote a row';
  END IF;

  v_returned := create_purchase_receipt(
    v_nulls,
    DATE '2026-10-05',
    NULL,
    NULL,
    NULL,
    jsonb_build_array(
      jsonb_build_object(
        'storage_path', v_nulls::text || '/only.jpg',
        'mime_type', 'image/webp',
        'size_bytes', 100
      )
    )
  );

  IF v_returned IS DISTINCT FROM v_nulls THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: null call returned %', v_returned;
  END IF;

  SELECT supplier_id, receipt_total, note
  INTO v_supplier_id, v_total, v_note
  FROM purchase_receipts
  WHERE id = v_nulls;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: null receipt is missing';
  END IF;
  IF v_supplier_id IS NOT NULL OR v_total IS NOT NULL OR v_note IS NOT NULL THEN
    RAISE EXCEPTION
      'SCENARIO H FAIL: supplier=% total=% note=%',
      v_supplier_id, v_total, v_note;
  END IF;

  RAISE NOTICE 'SCENARIO H PASS';

  -- I. Catalog. Run as the table owner so ACL reads are not role-limited.
  RESET ROLE;

  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: still authenticated';
  END IF;

  SELECT p.prosecdef
  INTO v_prosecdef
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_purchase_receipt';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: function is missing';
  END IF;
  IF v_prosecdef IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: prosecdef is %', v_prosecdef;
  END IF;

  SELECT
    has_function_privilege('anon', p.oid, 'EXECUTE'),
    has_function_privilege('authenticated', p.oid, 'EXECUTE'),
    CASE
      WHEN p.proacl IS NULL THEN true
      ELSE EXISTS (
        SELECT 1
        FROM aclexplode(p.proacl) AS x
        WHERE x.grantee = 0
          AND x.privilege_type = 'EXECUTE'
      )
    END
  INTO v_anon, v_authenticated, v_public
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'create_purchase_receipt';

  IF v_anon IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: anon can execute';
  END IF;
  IF v_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: PUBLIC can execute';
  END IF;
  IF v_authenticated IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: authenticated cannot execute';
  END IF;

  RAISE NOTICE 'SCENARIO I PASS';
  RAISE NOTICE 'create_purchase_receipt.sql PASS';
END;
$test$;

ROLLBACK;
