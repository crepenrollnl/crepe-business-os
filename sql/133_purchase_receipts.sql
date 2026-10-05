-- Purchase receipts — private bucket, receipt document, and pages.
-- Run in the Supabase SQL editor after sql/132_get_last_purchase_lines.sql.
-- Apply on both databases (dev + prod), as with every previous sql/*.sql.
--
-- A receipt is its own entity. purchase_id is nullable so the photo can be
-- saved before a draft purchase exists (a draft cannot be saved with zero
-- lines). Unlinked, non-discarded rows are the inbox. Several shots of one
-- paper receipt are pages (purchase_receipt_files), not separate receipts.
--
-- There is no DELETE policy and no DELETE grant. A bad photo is marked
-- discarded_at. created_by and created_at are database defaults and are
-- absent from every INSERT and UPDATE column list.
--
-- Idempotent: bucket ON CONFLICT DO UPDATE, DROP POLICY IF EXISTS,
-- CREATE TABLE IF NOT EXISTS, REVOKE then GRANT. No BEGIN/COMMIT in this
-- file. Storage policies follow sql/098 (get_my_role) and the bucket
-- shape follows sql/103, with public = false.

-- ---------------------------------------------------------------------------
-- 1. Private bucket purchase-receipts
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'purchase-receipts',
  'purchase-receipts',
  false,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. storage.objects policies (bucket_id = purchase-receipts only)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS purchase_receipts_objects_select ON storage.objects;
CREATE POLICY purchase_receipts_objects_select
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'purchase-receipts'
    AND get_my_role() IN ('owner', 'partner')
  );

DROP POLICY IF EXISTS purchase_receipts_objects_insert ON storage.objects;
CREATE POLICY purchase_receipts_objects_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'purchase-receipts'
    AND get_my_role() IN ('owner', 'partner')
  );

-- ---------------------------------------------------------------------------
-- 3. purchase_receipts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id uuid NULL REFERENCES purchases (id) ON DELETE SET NULL,
  supplier_id uuid NULL REFERENCES suppliers (id),
  receipt_date date NOT NULL,
  receipt_total numeric(12, 2) NULL,
  note text NULL,
  discarded_at timestamptz NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_receipts_receipt_total_check
    CHECK (receipt_total IS NULL OR receipt_total >= 0),
  CONSTRAINT purchase_receipts_discarded_unlinked_check
    CHECK (NOT (discarded_at IS NOT NULL AND purchase_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS purchase_receipts_purchase_id_idx
  ON purchase_receipts (purchase_id)
  WHERE purchase_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS purchase_receipts_inbox_idx
  ON purchase_receipts (receipt_date DESC, created_at DESC)
  WHERE purchase_id IS NULL AND discarded_at IS NULL;

COMMENT ON TABLE purchase_receipts IS
  'One photographed supplier receipt. purchase_id is null until the receipt is linked to a purchase. discarded_at retires a bad photo without deleting the row.';

-- ---------------------------------------------------------------------------
-- 4. purchase_receipt_files
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purchase_receipt_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES purchase_receipts (id) ON DELETE RESTRICT,
  page_number integer NOT NULL,
  storage_path text NOT NULL,
  original_filename text NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  drive_file_id text NULL,
  drive_synced_at timestamptz NULL,
  drive_error text NULL,
  drive_attempts integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_receipt_files_page_number_check
    CHECK (page_number >= 1),
  CONSTRAINT purchase_receipt_files_receipt_page_key
    UNIQUE (receipt_id, page_number),
  CONSTRAINT purchase_receipt_files_storage_path_key
    UNIQUE (storage_path),
  CONSTRAINT purchase_receipt_files_mime_type_check
    CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT purchase_receipt_files_size_bytes_check
    CHECK (size_bytes > 0 AND size_bytes <= 8388608),
  CONSTRAINT purchase_receipt_files_drive_attempts_check
    CHECK (drive_attempts >= 0),
  CONSTRAINT purchase_receipt_files_drive_pair_check
    CHECK ((drive_file_id IS NULL) = (drive_synced_at IS NULL))
);

CREATE INDEX IF NOT EXISTS purchase_receipt_files_pending_drive_idx
  ON purchase_receipt_files (created_at)
  WHERE drive_synced_at IS NULL;

COMMENT ON TABLE purchase_receipt_files IS
  'One stored page of a purchase receipt. drive_file_id and drive_synced_at are written together after a Drive copy; they are not client insert columns.';

-- ---------------------------------------------------------------------------
-- 5. RLS — owner and partner only. No DELETE policy.
-- ---------------------------------------------------------------------------

ALTER TABLE purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receipt_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_receipts_select ON purchase_receipts;
CREATE POLICY purchase_receipts_select
  ON purchase_receipts
  FOR SELECT
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS purchase_receipts_insert ON purchase_receipts;
CREATE POLICY purchase_receipts_insert
  ON purchase_receipts
  FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS purchase_receipts_update ON purchase_receipts;
CREATE POLICY purchase_receipts_update
  ON purchase_receipts
  FOR UPDATE
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS purchase_receipt_files_select ON purchase_receipt_files;
CREATE POLICY purchase_receipt_files_select
  ON purchase_receipt_files
  FOR SELECT
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS purchase_receipt_files_insert ON purchase_receipt_files;
CREATE POLICY purchase_receipt_files_insert
  ON purchase_receipt_files
  FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS purchase_receipt_files_update ON purchase_receipt_files;
CREATE POLICY purchase_receipt_files_update
  ON purchase_receipt_files
  FOR UPDATE
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

-- ---------------------------------------------------------------------------
-- 6. Grants. created_by and created_at are in no INSERT or UPDATE list.
--    service_role is not revoked here: the vanilla postgres:16 CI
--    bootstrap has no such role. Hosted Supabase default privileges
--    still leave service_role with ALL on these tables.
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE purchase_receipts FROM PUBLIC;
REVOKE ALL ON TABLE purchase_receipts FROM anon;
REVOKE ALL ON TABLE purchase_receipts FROM authenticated;

GRANT SELECT ON TABLE purchase_receipts TO authenticated;
GRANT INSERT (
  id,
  purchase_id,
  supplier_id,
  receipt_date,
  receipt_total,
  note
) ON TABLE purchase_receipts TO authenticated;
GRANT UPDATE (
  purchase_id,
  supplier_id,
  receipt_date,
  receipt_total,
  note,
  discarded_at
) ON TABLE purchase_receipts TO authenticated;

REVOKE ALL ON TABLE purchase_receipt_files FROM PUBLIC;
REVOKE ALL ON TABLE purchase_receipt_files FROM anon;
REVOKE ALL ON TABLE purchase_receipt_files FROM authenticated;

GRANT SELECT ON TABLE purchase_receipt_files TO authenticated;
GRANT INSERT (
  id,
  receipt_id,
  page_number,
  storage_path,
  original_filename,
  mime_type,
  size_bytes
) ON TABLE purchase_receipt_files TO authenticated;
GRANT UPDATE (
  drive_file_id,
  drive_synced_at,
  drive_error,
  drive_attempts
) ON TABLE purchase_receipt_files TO authenticated;
