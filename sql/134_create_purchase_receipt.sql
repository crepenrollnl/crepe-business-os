-- Create one purchase receipt and its pages in a single transaction.
-- Run in the Supabase SQL editor after sql/133_purchase_receipts.sql.
-- Apply on both databases (dev + prod). Idempotent CREATE OR REPLACE.
-- No BEGIN/COMMIT in this file.
--
-- A page row is inserted only after storage.objects contains that path in
-- the purchase-receipts bucket. Any error rolls the statement back, so a
-- receipt without its pages is not left behind.
--
-- SECURITY INVOKER, same header and grant shape as
-- get_last_purchase_lines in sql/132_get_last_purchase_lines.sql
-- (LANGUAGE plpgsql, SECURITY INVOKER, SET search_path = public, then
-- REVOKE FROM PUBLIC, REVOKE FROM anon, GRANT EXECUTE TO authenticated).
-- Not STABLE: this function inserts. Owner/partner is require_role, and
-- the column grants plus RLS from sql/133 still apply to the invoker.

CREATE OR REPLACE FUNCTION create_purchase_receipt(
  p_receipt_id uuid,
  p_receipt_date date,
  p_supplier_id uuid,
  p_receipt_total numeric,
  p_note text,
  p_files jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_note text;
  v_total numeric(12, 2);
  v_count integer;
  v_item jsonb;
  v_index bigint;
  v_path text;
  v_mime text;
  v_filename text;
  v_size bigint;
  v_prefix text;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_receipt_id IS NULL THEN
    RAISE EXCEPTION 'A receipt id is required.';
  END IF;

  IF p_receipt_date IS NULL THEN
    RAISE EXCEPTION 'A receipt date is required.';
  END IF;

  IF p_receipt_total IS NOT NULL AND p_receipt_total < 0 THEN
    RAISE EXCEPTION 'Receipt total cannot be negative.';
  END IF;

  v_total := CASE
    WHEN p_receipt_total IS NULL THEN NULL
    ELSE round(p_receipt_total, 2)
  END;

  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  IF p_files IS NULL OR jsonb_typeof(p_files) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Receipt photos must be a list.';
  END IF;

  v_count := jsonb_array_length(p_files);

  IF v_count < 1 THEN
    RAISE EXCEPTION 'Add at least one photo.';
  END IF;

  IF v_count > 10 THEN
    RAISE EXCEPTION 'A receipt can have at most 10 photos.';
  END IF;

  v_prefix := p_receipt_id::text || '/';

  FOR v_item, v_index IN
    SELECT value, ordinality
    FROM jsonb_array_elements(p_files) WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Each photo needs a storage path, a file type, and a file size.';
    END IF;

    v_path := NULLIF(btrim(COALESCE(v_item ->> 'storage_path', '')), '');
    v_mime := NULLIF(btrim(COALESCE(v_item ->> 'mime_type', '')), '');

    IF v_path IS NULL THEN
      RAISE EXCEPTION 'Each photo needs a storage path.';
    END IF;

    IF NOT starts_with(v_path, v_prefix) THEN
      RAISE EXCEPTION 'Photo storage path must belong to this receipt.';
    END IF;

    IF v_mime IS NULL THEN
      RAISE EXCEPTION 'Each photo needs a file type.';
    END IF;

    IF v_item ->> 'size_bytes' IS NULL
       OR (v_item ->> 'size_bytes') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Each photo needs a file size.';
    END IF;

    v_size := (v_item ->> 'size_bytes')::bigint;

    IF v_size <= 0 OR v_size > 8388608 THEN
      RAISE EXCEPTION 'Each photo must be larger than 0 bytes and at most 8 MB.';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM storage.objects
      WHERE bucket_id = 'purchase-receipts'
        AND name = v_path
    ) THEN
      RAISE EXCEPTION 'Receipt photo was not uploaded. Try again.';
    END IF;
  END LOOP;

  INSERT INTO purchase_receipts (
    id,
    supplier_id,
    receipt_date,
    receipt_total,
    note
  ) VALUES (
    p_receipt_id,
    p_supplier_id,
    p_receipt_date,
    v_total,
    v_note
  );

  FOR v_item, v_index IN
    SELECT value, ordinality
    FROM jsonb_array_elements(p_files) WITH ORDINALITY
  LOOP
    v_path := btrim(v_item ->> 'storage_path');
    v_mime := btrim(v_item ->> 'mime_type');
    v_filename := NULLIF(btrim(COALESCE(v_item ->> 'original_filename', '')), '');
    v_size := (v_item ->> 'size_bytes')::bigint;

    IF v_mime NOT IN ('image/jpeg', 'image/png', 'image/webp') THEN
      RAISE EXCEPTION 'Photo type must be JPEG, PNG, or WebP.';
    END IF;

    INSERT INTO purchase_receipt_files (
      receipt_id,
      page_number,
      storage_path,
      original_filename,
      mime_type,
      size_bytes
    ) VALUES (
      p_receipt_id,
      v_index::integer,
      v_path,
      v_filename,
      v_mime,
      v_size
    );
  END LOOP;

  RETURN p_receipt_id;
END;
$function$;

COMMENT ON FUNCTION create_purchase_receipt(uuid, date, uuid, numeric, text, jsonb) IS
  'Insert one purchase receipt and its pages. Page numbers follow the JSON array order. Invoker. Requires owner or partner.';

REVOKE ALL ON FUNCTION create_purchase_receipt(uuid, date, uuid, numeric, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_purchase_receipt(uuid, date, uuid, numeric, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION create_purchase_receipt(uuid, date, uuid, numeric, text, jsonb) TO authenticated;
