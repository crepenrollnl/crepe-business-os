-- SQL test: purchase receipt documents and pages (sql/133).
-- Scenarios A-J. Not a migration. Always ends in ROLLBACK.
--
-- Requires the full sql/*.sql replay, including
-- sql/133_purchase_receipts.sql, plus
-- tests/sql/bootstrap/prelude_auth.sql,
-- tests/sql/bootstrap/stub_suppliers.sql,
-- tests/sql/bootstrap/stub_storage.sql, and
-- tests/sql/bootstrap/stub_owner_profile.sql (applied by
-- .github/workflows/sql-tests.yml job purchase-receipts,
-- same prelude as job last-purchase-lines).
--
-- Column grants and RLS are invisible to the table owner, so this test
-- SET LOCAL ROLE authenticated after JWT emulation. Scenario I resets
-- to the table owner before deleting the draft purchase.
--
-- prelude_auth creates schema auth without GRANT USAGE. Live Supabase
-- grants that usage to authenticated; this rolled-back test does too,
-- or DEFAULT auth.uid() fails in CI for a reason that does not exist
-- on the hosted database.
--
-- PASS: psql -v ON_ERROR_STOP=1 -f tests/sql/purchase_receipts.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.expect_purchase_receipt_sqlstate(
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

GRANT EXECUTE ON FUNCTION public.expect_purchase_receipt_sqlstate(text, text, text)
  TO authenticated;

DO $test$
DECLARE
  v_owner uuid := '00000000-0000-4000-8000-000000000001';
  v_partner uuid := '00000000-0000-4000-8000-000000000133';
  v_seller uuid := '00000000-0000-4000-8000-000000000134';
  v_role text;
  v_claims text;
  v_supplier uuid;
  v_purchase uuid;
  v_receipt uuid;
  v_file uuid;
  v_file_2 uuid;
  v_receipt_i uuid;
  v_created_by uuid;
  v_created_at timestamptz;
  v_count integer;
  v_owner_receipts integer;
  v_purchase_after uuid;
  v_path text;
  v_drive_file_id text;
  v_drive_synced_at timestamptz;
  v_drive_error text;
  v_drive_attempts integer;
  v_public boolean;
  v_limit bigint;
  v_mimes text[];
  v_priv text;
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
  VALUES
    (v_partner, 'sql-replay-stub-partner-133@example.invalid'),
    (v_seller, 'sql-replay-stub-seller-133@example.invalid');

  INSERT INTO profiles (auth_user_id, role, is_active)
  VALUES
    (v_partner, 'partner', true),
    (v_seller, 'seller', true);

  INSERT INTO suppliers (code, name, is_active)
  VALUES ('T133RCPT', 'TEST_RCPT_133_supplier', true)
  RETURNING id INTO v_supplier;

  INSERT INTO purchases (supplier_id, status, notes)
  VALUES (v_supplier, 'draft', 'TEST_RCPT_133_draft')
  RETURNING id INTO v_purchase;

  IF v_purchase IS NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: draft purchase was not inserted';
  END IF;

  -- Live Supabase grants USAGE on schema auth. The CI stub does not.
  GRANT USAGE ON SCHEMA auth TO authenticated;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

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
    RAISE EXCEPTION
      'SCENARIO A FAIL: auth.uid() is % expected %',
      auth.uid(), v_owner;
  END IF;
  IF get_my_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: get_my_role() is %', get_my_role();
  END IF;

  -- A. Defaults fill created_by. The column is not in the INSERT list.
  INSERT INTO purchase_receipts (receipt_date, supplier_id, note)
  VALUES (DATE '2026-10-05', v_supplier, 'TEST_RCPT_133_A')
  RETURNING id, created_by, created_at
  INTO v_receipt, v_created_by, v_created_at;

  IF v_receipt IS NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: receipt insert returned no id';
  END IF;
  IF v_created_by IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: receipt created_by % expected %',
      v_created_by, v_owner;
  END IF;
  IF v_created_at IS NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: receipt created_at is null';
  END IF;

  INSERT INTO purchase_receipt_files (
    receipt_id,
    page_number,
    storage_path,
    original_filename,
    mime_type,
    size_bytes
  )
  VALUES (
    v_receipt,
    1,
    'purchase-receipts/a/page-1.jpg',
    'page-1.jpg',
    'image/jpeg',
    1200
  )
  RETURNING id, created_by
  INTO v_file, v_created_by;

  IF v_file IS NULL THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: file insert returned no id';
  END IF;
  IF v_created_by IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION
      'SCENARIO A FAIL: file created_by % expected %',
      v_created_by, v_owner;
  END IF;

  SELECT count(*) INTO v_owner_receipts FROM purchase_receipts;
  IF v_owner_receipts < 1 THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: owner sees no receipts after insert';
  END IF;

  RAISE NOTICE 'SCENARIO A PASS';

  -- B. Partner reads, links, unlinks, and discards the unlinked receipt.
  RESET ROLE;
  v_claims := json_build_object(
    'sub', v_partner::text,
    'role', 'authenticated'
  )::text;
  PERFORM set_config('request.jwt.claim.sub', v_partner::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);
  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'partner' THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: get_my_role() is %', get_my_role();
  END IF;

  SELECT count(*) INTO v_count
  FROM purchase_receipts
  WHERE id = v_receipt;

  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: partner sees % receipts', v_count;
  END IF;

  UPDATE purchase_receipts
  SET purchase_id = v_purchase
  WHERE id = v_receipt
  RETURNING purchase_id INTO v_purchase_after;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: link updated % rows', v_count;
  END IF;
  IF v_purchase_after IS DISTINCT FROM v_purchase THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: link left purchase_id %', v_purchase_after;
  END IF;

  UPDATE purchase_receipts
  SET purchase_id = NULL
  WHERE id = v_receipt
  RETURNING purchase_id INTO v_purchase_after;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: unlink updated % rows', v_count;
  END IF;
  IF v_purchase_after IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: unlink left purchase_id %', v_purchase_after;
  END IF;

  UPDATE purchase_receipts
  SET discarded_at = timestamptz '2026-10-05 15:00:00+00'
  WHERE id = v_receipt
    AND purchase_id IS NULL
  RETURNING discarded_at INTO v_created_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: discard updated % rows', v_count;
  END IF;
  IF v_created_at IS NULL THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: discard did not set discarded_at';
  END IF;

  RAISE NOTICE 'SCENARIO B PASS';

  -- C. Seller sees zero rows (RLS), and the insert is denied.
  -- A permission-denied SELECT is a failure: the row exists and SELECT
  -- is granted, so the seller result must be an empty set.
  RESET ROLE;
  SELECT count(*) INTO v_owner_receipts FROM purchase_receipts;
  IF v_owner_receipts < 1 THEN
    RAISE EXCEPTION
      'SCENARIO C FAIL: no receipt rows exist before the seller read';
  END IF;

  v_claims := json_build_object(
    'sub', v_seller::text,
    'role', 'authenticated'
  )::text;
  PERFORM set_config('request.jwt.claim.sub', v_seller::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', v_claims, true);
  SET LOCAL ROLE authenticated;

  IF get_my_role() IS DISTINCT FROM 'seller' THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: get_my_role() is %', get_my_role();
  END IF;

  BEGIN
    SELECT count(*) INTO v_count FROM purchase_receipts;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION
        'SCENARIO C FAIL: seller SELECT was permission denied, not zero rows';
  END;

  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller saw % receipt rows', v_count;
  END IF;

  BEGIN
    SELECT count(*) INTO v_count FROM purchase_receipt_files;
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE EXCEPTION
        'SCENARIO C FAIL: seller file SELECT was permission denied, not zero rows';
  END;

  IF v_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: seller saw % file rows', v_count;
  END IF;

  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO C',
    '42501',
    format(
      'INSERT INTO purchase_receipts (receipt_date, note) VALUES (DATE %L, %L)',
      '2026-10-05',
      'TEST_RCPT_133_C'
    )
  );

  RAISE NOTICE 'SCENARIO C PASS';

  -- D. Immutable columns are not in the UPDATE grant.
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
    RAISE EXCEPTION 'SCENARIO D FAIL: get_my_role() is %', get_my_role();
  END IF;

  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO D',
    '42501',
    format(
      'UPDATE purchase_receipt_files SET storage_path = %L WHERE id = %L',
      'purchase-receipts/a/changed.jpg',
      v_file
    )
  );
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO D',
    '42501',
    format(
      'UPDATE purchase_receipt_files SET receipt_id = %L WHERE id = %L',
      v_receipt,
      v_file
    )
  );
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO D',
    '42501',
    format(
      'UPDATE purchase_receipt_files SET created_by = %L WHERE id = %L',
      v_partner,
      v_file
    )
  );
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO D',
    '42501',
    format(
      'UPDATE purchase_receipt_files SET created_at = now() WHERE id = %L',
      v_file
    )
  );
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO D',
    '42501',
    format(
      'UPDATE purchase_receipts SET created_by = %L WHERE id = %L',
      v_partner,
      v_receipt
    )
  );
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO D',
    '42501',
    format(
      'UPDATE purchase_receipts SET created_at = now() WHERE id = %L',
      v_receipt
    )
  );

  SELECT storage_path INTO v_path
  FROM purchase_receipt_files
  WHERE id = v_file;

  IF v_path IS DISTINCT FROM 'purchase-receipts/a/page-1.jpg' THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: storage_path is now %', v_path;
  END IF;

  RAISE NOTICE 'SCENARIO D PASS';

  -- E. Explicit created_by, and drive_file_id at insert, are not granted.
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO E',
    '42501',
    format(
      'INSERT INTO purchase_receipts (receipt_date, created_by) VALUES (DATE %L, %L)',
      '2026-10-05',
      v_owner
    )
  );
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO E',
    '42501',
    format(
      'INSERT INTO purchase_receipt_files (receipt_id, page_number, storage_path, mime_type, size_bytes, drive_file_id) VALUES (%L, 8, %L, %L, 100, %L)',
      v_receipt,
      'purchase-receipts/a/page-8.jpg',
      'image/jpeg',
      'drive-at-insert'
    )
  );

  RAISE NOTICE 'SCENARIO E PASS';

  -- F. No DELETE grant on either table.
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO F',
    '42501',
    format('DELETE FROM purchase_receipt_files WHERE id = %L', v_file)
  );
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO F',
    '42501',
    format('DELETE FROM purchase_receipts WHERE id = %L', v_receipt)
  );

  SELECT count(*) INTO v_count
  FROM purchase_receipt_files
  WHERE id = v_file;

  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: file row count is %', v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM purchase_receipts
  WHERE id = v_receipt;

  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SCENARIO F FAIL: receipt row count is %', v_count;
  END IF;

  RAISE NOTICE 'SCENARIO F PASS';

  -- G. Checks and the page unique key. Each statement must raise.
  -- The receipt from B is discarded and unlinked.
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO G',
    '23514',
    format(
      'UPDATE purchase_receipts SET purchase_id = %L WHERE id = %L',
      v_purchase,
      v_receipt
    )
  );
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO G',
    '23514',
    format(
      'UPDATE purchase_receipt_files SET drive_file_id = %L WHERE id = %L',
      'drive-without-sync',
      v_file
    )
  );
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO G',
    '23505',
    format(
      'INSERT INTO purchase_receipt_files (receipt_id, page_number, storage_path, mime_type, size_bytes) VALUES (%L, 1, %L, %L, 100)',
      v_receipt,
      'purchase-receipts/a/page-1-dup.jpg',
      'image/jpeg'
    )
  );
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO G',
    '23514',
    'INSERT INTO purchase_receipts (receipt_date, receipt_total) VALUES (DATE ''2026-10-05'', -0.01)'
  );
  PERFORM public.expect_purchase_receipt_sqlstate(
    'SCENARIO G',
    '23514',
    format(
      'INSERT INTO purchase_receipt_files (receipt_id, page_number, storage_path, mime_type, size_bytes) VALUES (%L, 4, %L, %L, 100)',
      v_receipt,
      'purchase-receipts/a/page-4.heic',
      'image/heic'
    )
  );

  SELECT drive_file_id INTO v_drive_file_id
  FROM purchase_receipt_files
  WHERE id = v_file;

  IF v_drive_file_id IS NOT NULL THEN
    RAISE EXCEPTION
      'SCENARIO G FAIL: drive_file_id stuck at %',
      v_drive_file_id;
  END IF;

  RAISE NOTICE 'SCENARIO G PASS';

  -- H. Drive success is the pair. A later error increments attempts.
  UPDATE purchase_receipt_files
  SET drive_file_id = 'drive-file-1',
      drive_synced_at = timestamptz '2026-10-05 16:00:00+00'
  WHERE id = v_file
  RETURNING drive_file_id, drive_synced_at, drive_attempts
  INTO v_drive_file_id, v_drive_synced_at, v_drive_attempts;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: sync update changed % rows', v_count;
  END IF;
  IF v_drive_file_id IS DISTINCT FROM 'drive-file-1'
     OR v_drive_synced_at IS NULL
     OR v_drive_attempts IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION
      'SCENARIO H FAIL: sync result id=% synced=% attempts=%',
      v_drive_file_id, v_drive_synced_at, v_drive_attempts;
  END IF;

  INSERT INTO purchase_receipt_files (
    receipt_id,
    page_number,
    storage_path,
    mime_type,
    size_bytes
  )
  VALUES (
    v_receipt,
    2,
    'purchase-receipts/a/page-2.png',
    'image/png',
    2048
  )
  RETURNING id INTO v_file_2;

  IF v_file_2 IS NULL THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: second page was not inserted';
  END IF;

  UPDATE purchase_receipt_files
  SET drive_error = 'copy failed',
      drive_attempts = drive_attempts + 1
  WHERE id = v_file_2
  RETURNING drive_error, drive_attempts, drive_file_id, drive_synced_at
  INTO v_drive_error, v_drive_attempts, v_drive_file_id, v_drive_synced_at;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'SCENARIO H FAIL: error update changed % rows', v_count;
  END IF;
  IF v_drive_error IS DISTINCT FROM 'copy failed'
     OR v_drive_attempts IS DISTINCT FROM 1
     OR v_drive_file_id IS NOT NULL
     OR v_drive_synced_at IS NOT NULL THEN
    RAISE EXCEPTION
      'SCENARIO H FAIL: error result error=% attempts=% id=% synced=%',
      v_drive_error, v_drive_attempts, v_drive_file_id, v_drive_synced_at;
  END IF;

  RAISE NOTICE 'SCENARIO H PASS';

  -- I. Table owner deletes the draft purchase. The receipt stays, unlinked.
  INSERT INTO purchase_receipts (purchase_id, receipt_date, note)
  VALUES (v_purchase, DATE '2026-10-05', 'TEST_RCPT_133_I')
  RETURNING id INTO v_receipt_i;

  IF v_receipt_i IS NULL THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: linked receipt was not inserted';
  END IF;

  RESET ROLE;

  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: still authenticated before purchase delete';
  END IF;

  DELETE FROM purchases WHERE id = v_purchase;

  IF EXISTS (SELECT 1 FROM purchases WHERE id = v_purchase) THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: draft purchase was not deleted';
  END IF;

  SELECT purchase_id INTO v_purchase_after
  FROM purchase_receipts
  WHERE id = v_receipt_i;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: receipt was deleted with the purchase';
  END IF;
  IF v_purchase_after IS NOT NULL THEN
    RAISE EXCEPTION 'SCENARIO I FAIL: purchase_id still %', v_purchase_after;
  END IF;

  RAISE NOTICE 'SCENARIO I PASS';

  -- J. Bucket, the two storage policies, and table privileges.
  -- Positive grants are required so a database with no grants at all
  -- cannot pass the "anon and authenticated have no DELETE" checks.
  SELECT public, file_size_limit, allowed_mime_types
  INTO v_public, v_limit, v_mimes
  FROM storage.buckets
  WHERE id = 'purchase-receipts';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: bucket purchase-receipts is missing';
  END IF;
  IF v_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: bucket public is %', v_public;
  END IF;
  IF v_limit IS DISTINCT FROM 8388608 THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: file_size_limit is %', v_limit;
  END IF;
  IF v_mimes IS DISTINCT FROM ARRAY['image/jpeg', 'image/png', 'image/webp']::text[] THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: allowed_mime_types is %', v_mimes;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND (
      coalesce(qual, '') LIKE '%purchase-receipts%'
      OR coalesce(with_check, '') LIKE '%purchase-receipts%'
    );

  IF v_count IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION
      'SCENARIO J FAIL: storage policy count for this bucket is %',
      v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'purchase_receipts_objects_select'
      AND cmd = 'SELECT'
      AND 'authenticated' = ANY (roles)
  ) THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: SELECT storage policy missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'purchase_receipts_objects_insert'
      AND cmd = 'INSERT'
      AND 'authenticated' = ANY (roles)
  ) THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: INSERT storage policy missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        coalesce(qual, '') LIKE '%purchase-receipts%'
        OR coalesce(with_check, '') LIKE '%purchase-receipts%'
      )
      AND cmd IN ('UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: UPDATE or DELETE storage policy exists';
  END IF;

  FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']
  LOOP
    IF has_table_privilege('anon', 'public.purchase_receipts', v_priv) THEN
      RAISE EXCEPTION
        'SCENARIO J FAIL: anon has % on purchase_receipts', v_priv;
    END IF;
    IF has_table_privilege('anon', 'public.purchase_receipt_files', v_priv) THEN
      RAISE EXCEPTION
        'SCENARIO J FAIL: anon has % on purchase_receipt_files', v_priv;
    END IF;
  END LOOP;

  IF has_table_privilege('authenticated', 'public.purchase_receipts', 'DELETE') THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: authenticated can DELETE purchase_receipts';
  END IF;
  IF has_table_privilege('authenticated', 'public.purchase_receipt_files', 'DELETE') THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: authenticated can DELETE purchase_receipt_files';
  END IF;
  IF has_table_privilege('authenticated', 'public.purchase_receipts', 'TRUNCATE') THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: authenticated can TRUNCATE purchase_receipts';
  END IF;
  IF has_table_privilege('authenticated', 'public.purchase_receipt_files', 'TRUNCATE') THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: authenticated can TRUNCATE purchase_receipt_files';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.purchase_receipts', 'SELECT') THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: authenticated lacks SELECT on purchase_receipts';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.purchase_receipt_files', 'SELECT') THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: authenticated lacks SELECT on purchase_receipt_files';
  END IF;
  IF NOT has_column_privilege(
    'authenticated', 'public.purchase_receipts', 'receipt_date', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: authenticated cannot insert receipt_date';
  END IF;
  IF has_column_privilege(
    'authenticated', 'public.purchase_receipts', 'created_by', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: authenticated can insert created_by';
  END IF;
  IF has_column_privilege(
    'authenticated', 'public.purchase_receipts', 'created_at', 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: authenticated can update created_at';
  END IF;
  IF NOT has_column_privilege(
    'authenticated', 'public.purchase_receipt_files', 'drive_file_id', 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: authenticated cannot update drive_file_id';
  END IF;
  IF has_column_privilege(
    'authenticated', 'public.purchase_receipt_files', 'drive_file_id', 'INSERT'
  ) THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: authenticated can insert drive_file_id';
  END IF;
  IF has_column_privilege(
    'authenticated', 'public.purchase_receipt_files', 'storage_path', 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'SCENARIO J FAIL: authenticated can update storage_path';
  END IF;

  RAISE NOTICE 'SCENARIO J PASS';
  RAISE NOTICE 'purchase_receipts.sql PASS';
END;
$test$;

ROLLBACK;
