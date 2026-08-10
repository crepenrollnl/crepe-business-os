-- Backup & Restore Metadata Foundation (DEV-052)
-- Standalone backup_history metadata + create/complete/list RPCs.
--
-- Table:
--   backup_history
--
-- RPCs:
--   create_backup_record
--   complete_backup_record
--   list_backups
--
-- Metadata only. Does NOT:
--   - generate backup files
--   - store binary/file payloads
--   - implement restore logic
--   - implement authentication, login, JWT, or permissions
--   - enable RLS
--   - modify Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Users & Roles
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- backup_history
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS backup_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  backup_name text NOT NULL,
  backup_type text NOT NULL
    CHECK (backup_type IN ('full', 'incremental', 'manual')),

  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,

  file_size_bytes bigint
    CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  checksum text,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed')),

  notes text,

  CONSTRAINT backup_history_backup_name_not_blank
    CHECK (length(btrim(backup_name)) > 0),
  CONSTRAINT backup_history_completed_requires_metadata CHECK (
    status <> 'completed'
    OR (
      file_size_bytes IS NOT NULL
      AND checksum IS NOT NULL
      AND length(btrim(checksum)) > 0
    )
  )
);

COMMENT ON TABLE backup_history IS
  'Backup metadata history only. No file storage, generation, or restore logic.';

CREATE INDEX IF NOT EXISTS backup_history_created_at_idx
  ON backup_history (created_at DESC);

CREATE INDEX IF NOT EXISTS backup_history_status_idx
  ON backup_history (status);

CREATE INDEX IF NOT EXISTS backup_history_backup_type_idx
  ON backup_history (backup_type);

-- ---------------------------------------------------------------------------
-- Shared JSON projection
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION backup_history_to_jsonb(
  p_row backup_history
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'backup_name', p_row.backup_name,
    'backup_type', p_row.backup_type,
    'created_at', p_row.created_at,
    'created_by', p_row.created_by,
    'file_size_bytes', p_row.file_size_bytes,
    'checksum', p_row.checksum,
    'status', p_row.status,
    'notes', p_row.notes
  );
$$;

COMMENT ON FUNCTION backup_history_to_jsonb(backup_history) IS
  'Internal JSON projection for backup_history RPC responses.';

-- ---------------------------------------------------------------------------
-- create_backup_record
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_backup_record(
  p_backup_name text,
  p_backup_type text,
  p_created_by uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_backup_name text;
  v_backup_type text;
  v_notes text;
  v_backup_id uuid;
  v_now timestamptz := now();
BEGIN
  v_backup_name := NULLIF(btrim(COALESCE(p_backup_name, '')), '');
  IF v_backup_name IS NULL THEN
    RAISE EXCEPTION 'Backup name is required.';
  END IF;

  v_backup_type := NULLIF(btrim(COALESCE(p_backup_type, '')), '');
  IF v_backup_type IS NULL THEN
    RAISE EXCEPTION 'Backup type is required.';
  END IF;

  v_backup_type := lower(v_backup_type);
  IF v_backup_type NOT IN ('full', 'incremental', 'manual') THEN
    RAISE EXCEPTION 'Backup type is invalid.';
  END IF;

  v_notes := NULLIF(btrim(COALESCE(p_notes, '')), '');

  INSERT INTO backup_history (
    backup_name,
    backup_type,
    created_at,
    created_by,
    file_size_bytes,
    checksum,
    status,
    notes
  )
  VALUES (
    v_backup_name,
    v_backup_type,
    v_now,
    p_created_by,
    NULL,
    NULL,
    'pending',
    v_notes
  )
  RETURNING id INTO v_backup_id;

  RETURN jsonb_build_object(
    'backup_id', v_backup_id,
    'status', 'pending'
  );
END;
$$;

COMMENT ON FUNCTION create_backup_record(text, text, uuid, text) IS
  'Create a pending backup metadata record. Does not generate files.';

GRANT EXECUTE ON FUNCTION create_backup_record(text, text, uuid, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- complete_backup_record
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION complete_backup_record(
  p_backup_id uuid,
  p_status text DEFAULT 'completed',
  p_file_size_bytes bigint DEFAULT NULL,
  p_checksum text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_backup backup_history%ROWTYPE;
  v_status text;
  v_checksum text;
  v_notes text;
BEGIN
  IF p_backup_id IS NULL THEN
    RAISE EXCEPTION 'Backup id is required.';
  END IF;

  v_status := NULLIF(btrim(COALESCE(p_status, '')), '');
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Backup status is required.';
  END IF;

  v_status := lower(v_status);
  IF v_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Backup status is invalid.';
  END IF;

  SELECT *
  INTO v_backup
  FROM backup_history
  WHERE id = p_backup_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Backup was not found.';
  END IF;

  IF v_backup.status <> 'pending' THEN
    RAISE EXCEPTION 'Backup is not pending.';
  END IF;

  IF v_status = 'completed' THEN
    IF p_file_size_bytes IS NULL OR p_file_size_bytes < 0 THEN
      RAISE EXCEPTION 'File size bytes is required.';
    END IF;

    v_checksum := NULLIF(btrim(COALESCE(p_checksum, '')), '');
    IF v_checksum IS NULL THEN
      RAISE EXCEPTION 'Checksum is required.';
    END IF;
  ELSE
    IF p_file_size_bytes IS NOT NULL AND p_file_size_bytes < 0 THEN
      RAISE EXCEPTION 'File size bytes is invalid.';
    END IF;

    v_checksum := NULLIF(btrim(COALESCE(p_checksum, '')), '');
  END IF;

  IF p_notes IS NULL THEN
    v_notes := v_backup.notes;
  ELSE
    v_notes := NULLIF(btrim(p_notes), '');
  END IF;

  UPDATE backup_history
  SET
    status = v_status,
    file_size_bytes = CASE
      WHEN v_status = 'completed' THEN p_file_size_bytes
      ELSE COALESCE(p_file_size_bytes, v_backup.file_size_bytes)
    END,
    checksum = CASE
      WHEN v_status = 'completed' THEN v_checksum
      ELSE COALESCE(v_checksum, v_backup.checksum)
    END,
    notes = v_notes
  WHERE id = p_backup_id
  RETURNING * INTO v_backup;

  RETURN jsonb_build_object(
    'backup_id', v_backup.id,
    'status', v_backup.status
  );
END;
$$;

COMMENT ON FUNCTION complete_backup_record(uuid, text, bigint, text, text) IS
  'Complete or fail a pending backup metadata record. Does not store files or restore data.';

GRANT EXECUTE ON FUNCTION complete_backup_record(uuid, text, bigint, text, text)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- list_backups
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION list_backups()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT COALESCE(
    jsonb_agg(
      backup_history_to_jsonb(b)
      ORDER BY b.created_at DESC, b.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM backup_history b;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION list_backups() IS
  'List backup metadata rows ordered by created_at DESC. Metadata only.';

GRANT EXECUTE ON FUNCTION list_backups() TO authenticated;
