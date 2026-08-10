-- Export Jobs Metadata Foundation (DEV-054)
-- Standalone export_jobs metadata + create/progress/complete/list RPCs.
--
-- Table:
--   export_jobs
--
-- RPCs:
--   create_export_job
--   update_export_job_progress
--   complete_export_job
--   list_export_jobs
--
-- Metadata only. Does NOT:
--   - generate export files
--   - execute exports or read/mutate domain tables
--   - store file payloads
--   - implement authentication, login, JWT, or permissions
--   - enable RLS
--   - modify Inventory / Purchases / Production / Sales / Customers /
--     Suppliers / Dashboard / Reporting / Global Search / Audit Log /
--     Notifications / Company Settings / Backup / Import / Users & Roles
--   - create UI, hooks, services, or tests

-- ---------------------------------------------------------------------------
-- export_jobs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  export_type text NOT NULL
    CHECK (
      export_type IN (
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
  exported_rows integer NOT NULL DEFAULT 0
    CHECK (exported_rows >= 0),

  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid,
  error_summary text,

  CONSTRAINT export_jobs_file_name_not_blank
    CHECK (length(btrim(file_name)) > 0),
  CONSTRAINT export_jobs_row_counts_consistent CHECK (
    total_rows IS NULL OR exported_rows <= total_rows
  ),
  CONSTRAINT export_jobs_completed_has_timestamp CHECK (
    status NOT IN ('completed', 'failed')
    OR completed_at IS NOT NULL
  )
);

COMMENT ON TABLE export_jobs IS
  'Export job metadata only. No file generation, export execution, or domain mutations.';

CREATE INDEX IF NOT EXISTS export_jobs_started_at_idx
  ON export_jobs (started_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS export_jobs_status_idx
  ON export_jobs (status);

CREATE INDEX IF NOT EXISTS export_jobs_export_type_idx
  ON export_jobs (export_type);

-- ---------------------------------------------------------------------------
-- Shared JSON projection
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION export_job_to_jsonb(
  p_row export_jobs
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'export_type', p_row.export_type,
    'file_name', p_row.file_name,
    'status', p_row.status,
    'total_rows', p_row.total_rows,
    'exported_rows', p_row.exported_rows,
    'started_at', p_row.started_at,
    'completed_at', p_row.completed_at,
    'created_by', p_row.created_by,
    'error_summary', p_row.error_summary
  );
$$;

COMMENT ON FUNCTION export_job_to_jsonb(export_jobs) IS
  'Internal JSON projection for export_jobs RPC responses.';

-- ---------------------------------------------------------------------------
-- create_export_job
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_export_job(
  p_export_type text,
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
  v_export_type text;
  v_file_name text;
  v_job_id uuid;
BEGIN
  v_export_type := NULLIF(btrim(COALESCE(p_export_type, '')), '');
  IF v_export_type IS NULL THEN
    RAISE EXCEPTION 'Export type is required.';
  END IF;

  v_export_type := lower(v_export_type);
  IF v_export_type NOT IN (
    'ingredients',
    'customers',
    'suppliers',
    'products',
    'recipes',
    'purchases',
    'sales'
  ) THEN
    RAISE EXCEPTION 'Export type is invalid.';
  END IF;

  v_file_name := NULLIF(btrim(COALESCE(p_file_name, '')), '');
  IF v_file_name IS NULL THEN
    RAISE EXCEPTION 'File name is required.';
  END IF;

  IF p_total_rows IS NOT NULL AND p_total_rows < 0 THEN
    RAISE EXCEPTION 'Total rows is invalid.';
  END IF;

  INSERT INTO export_jobs (
    export_type,
    file_name,
    status,
    total_rows,
    exported_rows,
    started_at,
    completed_at,
    created_by,
    error_summary
  )
  VALUES (
    v_export_type,
    v_file_name,
    'pending',
    p_total_rows,
    0,
    NULL,
    NULL,
    p_created_by,
    NULL
  )
  RETURNING id INTO v_job_id;

  RETURN jsonb_build_object(
    'export_job_id', v_job_id,
    'status', 'pending'
  );
END;
$$;

COMMENT ON FUNCTION create_export_job(text, text, uuid, integer) IS
  'Create a pending export job metadata record. Does not generate files or export rows.';

GRANT EXECUTE ON FUNCTION create_export_job(text, text, uuid, integer)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- update_export_job_progress
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION update_export_job_progress(
  p_export_job_id uuid,
  p_exported_rows integer,
  p_total_rows integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job export_jobs%ROWTYPE;
  v_total_rows integer;
  v_now timestamptz := now();
BEGIN
  IF p_export_job_id IS NULL THEN
    RAISE EXCEPTION 'Export job id is required.';
  END IF;

  IF p_exported_rows IS NULL OR p_exported_rows < 0 THEN
    RAISE EXCEPTION 'Exported rows is required.';
  END IF;

  IF p_total_rows IS NOT NULL AND p_total_rows < 0 THEN
    RAISE EXCEPTION 'Total rows is invalid.';
  END IF;

  SELECT *
  INTO v_job
  FROM export_jobs
  WHERE id = p_export_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Export job was not found.';
  END IF;

  IF v_job.status IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Export job is already finished.';
  END IF;

  v_total_rows := COALESCE(p_total_rows, v_job.total_rows);

  IF v_total_rows IS NOT NULL AND p_exported_rows > v_total_rows THEN
    RAISE EXCEPTION 'Exported rows cannot exceed total rows.';
  END IF;

  UPDATE export_jobs
  SET
    status = 'running',
    exported_rows = p_exported_rows,
    total_rows = v_total_rows,
    started_at = COALESCE(started_at, v_now)
  WHERE id = p_export_job_id
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'export_job_id', v_job.id,
    'status', v_job.status,
    'exported_rows', v_job.exported_rows,
    'total_rows', v_job.total_rows
  );
END;
$$;

COMMENT ON FUNCTION update_export_job_progress(uuid, integer, integer) IS
  'Update running export job progress counters. Does not generate files or export rows.';

GRANT EXECUTE ON FUNCTION update_export_job_progress(uuid, integer, integer)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- complete_export_job
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION complete_export_job(
  p_export_job_id uuid,
  p_status text DEFAULT 'completed',
  p_exported_rows integer DEFAULT NULL,
  p_total_rows integer DEFAULT NULL,
  p_error_summary text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job export_jobs%ROWTYPE;
  v_status text;
  v_exported_rows integer;
  v_total_rows integer;
  v_error_summary text;
  v_now timestamptz := now();
BEGIN
  IF p_export_job_id IS NULL THEN
    RAISE EXCEPTION 'Export job id is required.';
  END IF;

  v_status := NULLIF(btrim(COALESCE(p_status, '')), '');
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Export status is required.';
  END IF;

  v_status := lower(v_status);
  IF v_status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Export status is invalid.';
  END IF;

  SELECT *
  INTO v_job
  FROM export_jobs
  WHERE id = p_export_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Export job was not found.';
  END IF;

  IF v_job.status IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'Export job is already finished.';
  END IF;

  v_exported_rows := COALESCE(p_exported_rows, v_job.exported_rows);
  v_total_rows := COALESCE(p_total_rows, v_job.total_rows);

  IF v_exported_rows < 0 THEN
    RAISE EXCEPTION 'Exported rows is invalid.';
  END IF;

  IF v_total_rows IS NOT NULL AND v_total_rows < 0 THEN
    RAISE EXCEPTION 'Total rows is invalid.';
  END IF;

  IF v_total_rows IS NOT NULL AND v_exported_rows > v_total_rows THEN
    RAISE EXCEPTION 'Exported rows cannot exceed total rows.';
  END IF;

  IF p_error_summary IS NULL THEN
    v_error_summary := v_job.error_summary;
  ELSE
    v_error_summary := NULLIF(btrim(p_error_summary), '');
  END IF;

  IF v_status = 'failed' AND v_error_summary IS NULL THEN
    RAISE EXCEPTION 'Error summary is required.';
  END IF;

  UPDATE export_jobs
  SET
    status = v_status,
    exported_rows = v_exported_rows,
    total_rows = v_total_rows,
    started_at = COALESCE(started_at, v_now),
    completed_at = v_now,
    error_summary = v_error_summary
  WHERE id = p_export_job_id
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'export_job_id', v_job.id,
    'status', v_job.status
  );
END;
$$;

COMMENT ON FUNCTION complete_export_job(
  uuid, text, integer, integer, text
) IS
  'Complete or fail an export job metadata record. Does not generate files or export rows.';

GRANT EXECUTE ON FUNCTION complete_export_job(
  uuid, text, integer, integer, text
) TO authenticated;

-- ---------------------------------------------------------------------------
-- list_export_jobs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION list_export_jobs()
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
      export_job_to_jsonb(j)
      ORDER BY
        COALESCE(j.started_at, j.completed_at) DESC NULLS LAST,
        j.id ASC
    ),
    '[]'::jsonb
  )
  INTO v_result
  FROM export_jobs j;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION list_export_jobs() IS
  'List export job metadata rows. Metadata only.';

GRANT EXECUTE ON FUNCTION list_export_jobs() TO authenticated;
