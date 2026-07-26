-- Import Jobs Metadata Foundation (DEV-053)
-- Standalone import_jobs metadata + create/progress/complete/list RPCs.
--
-- Table:
--   import_jobs
--
-- RPCs:
--   create_import_job
--   update_import_job_progress
--   complete_import_job
--   list_import_jobs
--
-- Metadata only. Does NOT:
--   - parse import files
--   - execute imports or mutate domain tables
--   - store file payloads
--   - implement authentication, login, JWT, or permissions
--   - enable RLS
--   - modify Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Users & Roles
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- import_jobs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  import_type text NOT NULL
    CHECK (
      import_type IN (
        'ingredients',
        'customers',
        'suppliers',
        'products',
        'recipes',
        'purchases',
        'sales'
      )
    ),

  file_name text NOT NULL,

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),

  total_rows integer
    CHECK (total_rows IS NULL OR total_rows >= 0),
  processed_rows integer NOT NULL DEFAULT 0
    CHECK (processed_rows >= 0),
  failed_rows integer NOT NULL DEFAULT 0
    CHECK (failed_rows >= 0),

  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  error_summary text,

  CONSTRAINT import_jobs_file_name_not_blank
    CHECK (length(btrim(file_name)) > 0),
  CONSTRAINT import_jobs_row_counts_consistent CHECK (
    processed_rows >= failed_rows
  ),
  CONSTRAINT import_jobs_completed_has_timestamp CHECK (
    status NOT IN ('completed', 'failed')
    OR completed_at IS NOT NULL
  )
);

COMMENT ON TABLE import_jobs IS
  'Import job metadata only. No file parsing, import execution, or domain mutations.';

CREATE INDEX IF NOT EXISTS import_jobs_started_at_idx
  ON import_jobs (started_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS import_jobs_status_idx
  ON import_jobs (status);

CREATE INDEX IF NOT EXISTS import_jobs_import_type_idx
  ON import_jobs (import_type);

-- ---------------------------------------------------------------------------
-- Shared JSON projection
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION import_job_to_jsonb(
  p_row import_jobs
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'import_type', p_row.import_type,
    'file_name', p_row.file_name,
    'status', p_row.status,
    'total_rows', p_row.total_rows,
    'processed_rows', p_row.processed_rows,
    'failed_rows', p_row.failed_rows,
    'started_at', p_row.started_at,
    'completed_at', p_row.completed_at,
    'created_by', p_row.created_by,
    'error_summary', p_row.error_summary
  );
$$;

COMMENT ON FUNCTION import_job_to_jsonb(import_jobs) IS
  'Internal JSON projection for import_jobs RPC responses.';

-- ---------------------------------------------------------------------------
-- create_import_job
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_import_job(
  p_import_type text,
  p_file_name text,
  p_created_by uuid DEFAULT NULL,
  p_total_rows integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_import_type text;
  v_file_name text;
  v_job_id uuid;
BEGIN
  v_import_type := NULLIF(btrim(COALESCE(p_import_type, '')), '');
  IF v_import_type IS NULL THEN
    RAISE EXCEPTION 'Import type is required.';
  END IF;

  v_import_type := lower(v_import_type);
  IF v_import_type NOT IN (
    'ingredients',
    'customers',
    'suppliers',
    'products',
    'recipes',
    'purchases',
    'sales'
  ) THEN
    RAISE EXCEPTION 'Import type is invalid.';
  END IF;

  v_file_name := NULLIF(btrim(COALESCE(p_file_name, '')), '');
  IF v_file_name IS NULL THEN
    RAISE EXCEPTION 'File name is required.';
  END IF;

  IF p_total_rows IS NOT NULL AND p_total_rows < 0 THEN
    RAISE EXCEPTION 'Total rows is invalid.';
  END IF;

  INSERT INTO import_jobs (
    import_type,
    file_name,
    status,
    total_rows,
    processed_rows,
    failed_rows,
    started_at,
    completed_at,
    created_by,
    error_summary
  )
  VALUES (
    v_import_type,
    v_file_name,
    'pending',
    p_total_rows,
    0,
    0,
    NULL,
    NULL,
    p_created_by,
    NULL
  )
  RETURNING id INTO v_job_id;

  RETURN jsonb_build_object(
    'import_job_id', v_job_id,
    'status', 'pending'
  );
END;
$$;

COMMENT ON FUNCTION create_import_job(text, text, uuid, integer) IS
  'Create a pending import job metadata record. Does not parse files or import rows.';

GRANT EXECUTE ON FUNCTION create_import_job(text, text, uuid, integer)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- update_import_job_progress
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_import_job_progress(
  p_import_job_id uuid,
  p_processed_rows integer,
  p_failed_rows integer DEFAULT 0,
  p_total_rows integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job import_jobs%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF p_import_job_id IS NULL THEN
    RAISE EXCEPTION 'Import job id is required.';
  END IF;

  IF p_processed_rows IS NULL OR p_processed_rows < 0 THEN
    RAISE EXCEPTION 'Processed rows is required.';
  END IF;

  IF p_failed_rows IS NULL OR p_failed_rows < 0 THEN
    RAISE EXCEPTION 'Failed rows is invalid.';
  END IF;

  IF p_failed_rows > p_processed_rows THEN
    RAISE EXCEPTION 'Failed rows cannot exceed processed rows.';
  END IF;

  IF p_total_rows IS NOT NULL AND p_total_rows < 0 THEN
    RAISE EXCEPTION 'Total rows is invalid.';
  END IF;

  SELECT *
  INTO v_job
  FROM import_jobs
  WHERE id = p_import_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import job was not found.';
  END IF;

  IF v_job.status IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Import job is already finished.';
  END IF;

  UPDATE import_jobs
  SET
    status = 'running',
    processed_rows = p_processed_rows,
    failed_rows = p_failed_rows,
    total_rows = COALESCE(p_total_rows, total_rows),
    started_at = COALESCE(started_at, v_now)
  WHERE id = p_import_job_id
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'import_job_id', v_job.id,
    'status', v_job.status,
    'processed_rows', v_job.processed_rows,
    'failed_rows', v_job.failed_rows,
    'total_rows', v_job.total_rows
  );
END;
$$;

COMMENT ON FUNCTION update_import_job_progress(uuid, integer, integer, integer) IS
  'Update running import job progress counters. Does not parse files or import rows.';

GRANT EXECUTE ON FUNCTION update_import_job_progress(uuid, integer, integer, integer)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- complete_import_job
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION complete_import_job(
  p_import_job_id uuid,
  p_status text DEFAULT 'completed',
  p_processed_rows integer DEFAULT NULL,
  p_failed_rows integer DEFAULT NULL,
  p_total_rows integer DEFAULT NULL,
  p_error_summary text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job import_jobs%ROWTYPE;
  v_status text;
  v_processed_rows integer;
  v_failed_rows integer;
  v_total_rows integer;
  v_error_summary text;
  v_now timestamptz := now();
BEGIN
  IF p_import_job_id IS NULL THEN
    RAISE EXCEPTION 'Import job id is required.';
  END IF;

  v_status := NULLIF(btrim(COALESCE(p_status, '')), '');
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Import status is required.';
  END IF;

  v_status := lower(v_status);
  IF v_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Import status is invalid.';
  END IF;

  SELECT *
  INTO v_job
  FROM import_jobs
  WHERE id = p_import_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Import job was not found.';
  END IF;

  IF v_job.status IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Import job is already finished.';
  END IF;

  v_processed_rows := COALESCE(p_processed_rows, v_job.processed_rows);
  v_failed_rows := COALESCE(p_failed_rows, v_job.failed_rows);
  v_total_rows := COALESCE(p_total_rows, v_job.total_rows);

  IF v_processed_rows < 0 THEN
    RAISE EXCEPTION 'Processed rows is invalid.';
  END IF;

  IF v_failed_rows < 0 THEN
    RAISE EXCEPTION 'Failed rows is invalid.';
  END IF;

  IF v_failed_rows > v_processed_rows THEN
    RAISE EXCEPTION 'Failed rows cannot exceed processed rows.';
  END IF;

  IF v_total_rows IS NOT NULL AND v_total_rows < 0 THEN
    RAISE EXCEPTION 'Total rows is invalid.';
  END IF;

  IF p_error_summary IS NULL THEN
    v_error_summary := v_job.error_summary;
  ELSE
    v_error_summary := NULLIF(btrim(p_error_summary), '');
  END IF;

  IF v_status = 'failed' AND v_error_summary IS NULL THEN
    RAISE EXCEPTION 'Error summary is required.';
  END IF;

  UPDATE import_jobs
  SET
    status = v_status,
    processed_rows = v_processed_rows,
    failed_rows = v_failed_rows,
    total_rows = v_total_rows,
    started_at = COALESCE(started_at, v_now),
    completed_at = v_now,
    error_summary = v_error_summary
  WHERE id = p_import_job_id
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'import_job_id', v_job.id,
    'status', v_job.status
  );
END;
$$;

COMMENT ON FUNCTION complete_import_job(
  uuid, text, integer, integer, integer, text
) IS
  'Complete or fail an import job metadata record. Does not parse files or import rows.';

GRANT EXECUTE ON FUNCTION complete_import_job(
  uuid, text, integer, integer, integer, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- list_import_jobs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION list_import_jobs()
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
      import_job_to_jsonb(j)
      ORDER BY
        COALESCE(j.started_at, j.completed_at) DESC NULLS LAST,
        j.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM import_jobs j;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION list_import_jobs() IS
  'List import job metadata rows. Metadata only.';

GRANT EXECUTE ON FUNCTION list_import_jobs() TO authenticated;
