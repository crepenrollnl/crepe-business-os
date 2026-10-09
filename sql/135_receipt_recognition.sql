-- Receipt recognition — stored AI results and the receipt-line memory.
-- Run in the Supabase SQL editor after sql/134_create_purchase_receipt.sql.
-- Apply on both databases (dev + prod). Idempotent. No BEGIN/COMMIT here.
--
-- purchase_receipt_recognitions: one row per recognition attempt of a
--   receipt (succeeded with a JSON result, or failed with a short safe
--   error). Written by the server route under the caller's own session,
--   so RLS applies. Never updated or deleted: a stored success is reused
--   instead of paying for the same receipt twice.
--
-- receipt_line_mappings: memory "supplier + receipt line text -> what it
--   is". Either an ingredient plus how many ingredient units one receipt
--   item holds, or "skip" (bag, deposit, non-food). One row per supplier
--   and normalized text. Written through remember_receipt_line_mapping();
--   read through match_receipt_lines(). receipt_line_text_key() is the one
--   normalizer, used by the CHECK, the RPC and the lookup, so the app never
--   normalizes text itself.
--
-- Owner and partner only. No DELETE policy and no DELETE grant on either
-- table. created_by / created_at / updated_by / updated_at are set by the
-- database and are absent from every INSERT and UPDATE column grant.

-- ---------------------------------------------------------------------------
-- 1. Normalizer: lower case, every run of non-alphanumerics -> one space,
--    trimmed. Empty result -> NULL.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION receipt_line_text_key(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $function$
  SELECT NULLIF(
    btrim(regexp_replace(lower(COALESCE(p_text, '')), '[^[:alnum:]]+', ' ', 'g')),
    ''
  );
$function$;

COMMENT ON FUNCTION receipt_line_text_key(text) IS
  'Normalized key of a receipt line text: lower case, non-alphanumeric runs collapsed to one space, trimmed; NULL when nothing is left.';

REVOKE ALL ON FUNCTION receipt_line_text_key(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION receipt_line_text_key(text) FROM anon;
GRANT EXECUTE ON FUNCTION receipt_line_text_key(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. purchase_receipt_recognitions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purchase_receipt_recognitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES purchase_receipts (id) ON DELETE RESTRICT,
  status text NOT NULL,
  model text NOT NULL,
  result jsonb NULL,
  error text NULL,
  input_tokens integer NULL,
  output_tokens integer NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_receipt_recognitions_status_check
    CHECK (status IN ('succeeded', 'failed')),
  CONSTRAINT purchase_receipt_recognitions_model_check
    CHECK (char_length(model) BETWEEN 1 AND 100),
  CONSTRAINT purchase_receipt_recognitions_result_check
    CHECK ((status = 'succeeded') = (result IS NOT NULL)),
  CONSTRAINT purchase_receipt_recognitions_result_shape_check
    CHECK (
      result IS NULL
      OR (jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 100000)
    ),
  CONSTRAINT purchase_receipt_recognitions_error_check
    CHECK ((status = 'failed') = (error IS NOT NULL)),
  CONSTRAINT purchase_receipt_recognitions_error_length_check
    CHECK (error IS NULL OR char_length(error) BETWEEN 1 AND 200),
  CONSTRAINT purchase_receipt_recognitions_tokens_check
    CHECK (
      (input_tokens IS NULL OR input_tokens >= 0)
      AND (output_tokens IS NULL OR output_tokens >= 0)
    )
);

CREATE INDEX IF NOT EXISTS purchase_receipt_recognitions_receipt_idx
  ON purchase_receipt_recognitions (receipt_id, created_at DESC);

COMMENT ON TABLE purchase_receipt_recognitions IS
  'One AI recognition attempt of a purchase receipt. succeeded rows carry the JSON result, failed rows a short safe error. Insert-only.';

-- ---------------------------------------------------------------------------
-- 3. receipt_line_mappings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS receipt_line_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES suppliers (id) ON DELETE CASCADE,
  text_key text NOT NULL,
  receipt_text text NOT NULL,
  action text NOT NULL,
  ingredient_id uuid NULL REFERENCES ingredients (id) ON DELETE CASCADE,
  units_per_item numeric(12, 4) NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL DEFAULT auth.uid(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipt_line_mappings_supplier_text_key
    UNIQUE (supplier_id, text_key),
  CONSTRAINT receipt_line_mappings_text_key_check
    CHECK (
      char_length(text_key) BETWEEN 1 AND 200
      AND text_key IS NOT DISTINCT FROM receipt_line_text_key(text_key)
    ),
  CONSTRAINT receipt_line_mappings_receipt_text_check
    CHECK (
      char_length(receipt_text) BETWEEN 1 AND 200
      AND receipt_line_text_key(receipt_text) IS NOT DISTINCT FROM text_key
    ),
  CONSTRAINT receipt_line_mappings_action_check
    CHECK (action IN ('ingredient', 'skip')),
  CONSTRAINT receipt_line_mappings_action_fields_check
    CHECK (
      (action = 'ingredient' AND ingredient_id IS NOT NULL AND units_per_item IS NOT NULL)
      OR (action = 'skip' AND ingredient_id IS NULL AND units_per_item IS NULL)
    ),
  CONSTRAINT receipt_line_mappings_units_check
    CHECK (units_per_item IS NULL OR (units_per_item > 0 AND units_per_item <= 100000))
);

COMMENT ON TABLE receipt_line_mappings IS
  'Memory of what a supplier receipt line is: an ingredient with units per receipt item, or skip. One row per supplier and normalized text.';

-- updated_by / updated_at are always set by the database on update.
CREATE OR REPLACE FUNCTION receipt_line_mappings_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_by := COALESCE(auth.uid(), OLD.updated_by);
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION receipt_line_mappings_touch() FROM PUBLIC;
REVOKE ALL ON FUNCTION receipt_line_mappings_touch() FROM anon;

DROP TRIGGER IF EXISTS receipt_line_mappings_touch ON receipt_line_mappings;
CREATE TRIGGER receipt_line_mappings_touch
  BEFORE UPDATE ON receipt_line_mappings
  FOR EACH ROW
  EXECUTE FUNCTION receipt_line_mappings_touch();

-- ---------------------------------------------------------------------------
-- 4. RLS — owner and partner only. No DELETE policy. Recognitions: no UPDATE.
-- ---------------------------------------------------------------------------

ALTER TABLE purchase_receipt_recognitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_line_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS purchase_receipt_recognitions_select ON purchase_receipt_recognitions;
CREATE POLICY purchase_receipt_recognitions_select
  ON purchase_receipt_recognitions
  FOR SELECT
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS purchase_receipt_recognitions_insert ON purchase_receipt_recognitions;
CREATE POLICY purchase_receipt_recognitions_insert
  ON purchase_receipt_recognitions
  FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS receipt_line_mappings_select ON receipt_line_mappings;
CREATE POLICY receipt_line_mappings_select
  ON receipt_line_mappings
  FOR SELECT
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS receipt_line_mappings_insert ON receipt_line_mappings;
CREATE POLICY receipt_line_mappings_insert
  ON receipt_line_mappings
  FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

DROP POLICY IF EXISTS receipt_line_mappings_update ON receipt_line_mappings;
CREATE POLICY receipt_line_mappings_update
  ON receipt_line_mappings
  FOR UPDATE
  TO authenticated
  USING (get_my_role() IN ('owner', 'partner'))
  WITH CHECK (get_my_role() IN ('owner', 'partner'));

-- ---------------------------------------------------------------------------
-- 5. Grants. Database-set columns are in no INSERT or UPDATE list.
--    service_role is not revoked (the CI bootstrap has no such role).
-- ---------------------------------------------------------------------------

REVOKE ALL ON TABLE purchase_receipt_recognitions FROM PUBLIC;
REVOKE ALL ON TABLE purchase_receipt_recognitions FROM anon;
REVOKE ALL ON TABLE purchase_receipt_recognitions FROM authenticated;

GRANT SELECT ON TABLE purchase_receipt_recognitions TO authenticated;
GRANT INSERT (
  receipt_id,
  status,
  model,
  result,
  error,
  input_tokens,
  output_tokens
) ON TABLE purchase_receipt_recognitions TO authenticated;

REVOKE ALL ON TABLE receipt_line_mappings FROM PUBLIC;
REVOKE ALL ON TABLE receipt_line_mappings FROM anon;
REVOKE ALL ON TABLE receipt_line_mappings FROM authenticated;

GRANT SELECT ON TABLE receipt_line_mappings TO authenticated;
GRANT INSERT (
  supplier_id,
  text_key,
  receipt_text,
  action,
  ingredient_id,
  units_per_item
) ON TABLE receipt_line_mappings TO authenticated;
GRANT UPDATE (
  receipt_text,
  action,
  ingredient_id,
  units_per_item
) ON TABLE receipt_line_mappings TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. remember_receipt_line_mapping — create or replace one memory row.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION remember_receipt_line_mapping(
  p_supplier_id uuid,
  p_receipt_text text,
  p_action text,
  p_ingredient_id uuid,
  p_units_per_item numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_text text;
  v_key text;
  v_action text;
  v_units numeric(12, 4);
  v_id uuid;
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'A supplier is required.';
  END IF;

  v_text := btrim(regexp_replace(COALESCE(p_receipt_text, ''), '\s+', ' ', 'g'));
  v_key := receipt_line_text_key(v_text);

  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Receipt line text is required.';
  END IF;

  IF char_length(v_text) > 200 OR char_length(v_key) > 200 THEN
    RAISE EXCEPTION 'Receipt line text is too long.';
  END IF;

  v_action := lower(btrim(COALESCE(p_action, '')));

  IF v_action = 'ingredient' THEN
    IF p_ingredient_id IS NULL THEN
      RAISE EXCEPTION 'Choose an ingredient.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM ingredients WHERE id = p_ingredient_id) THEN
      RAISE EXCEPTION 'Ingredient not found.';
    END IF;

    IF p_units_per_item IS NULL OR p_units_per_item <= 0 THEN
      RAISE EXCEPTION 'Units per receipt item must be greater than 0.';
    END IF;

    v_units := round(p_units_per_item, 4);

    IF v_units <= 0 OR v_units > 100000 THEN
      RAISE EXCEPTION 'Units per receipt item must be between 0.0001 and 100000.';
    END IF;
  ELSIF v_action = 'skip' THEN
    IF p_ingredient_id IS NOT NULL OR p_units_per_item IS NOT NULL THEN
      RAISE EXCEPTION 'A skipped line has no ingredient.';
    END IF;

    v_units := NULL;
  ELSE
    RAISE EXCEPTION 'Action must be ingredient or skip.';
  END IF;

  INSERT INTO receipt_line_mappings AS m (
    supplier_id,
    text_key,
    receipt_text,
    action,
    ingredient_id,
    units_per_item
  ) VALUES (
    p_supplier_id,
    v_key,
    v_text,
    v_action,
    CASE WHEN v_action = 'ingredient' THEN p_ingredient_id END,
    v_units
  )
  ON CONFLICT (supplier_id, text_key) DO UPDATE
  SET
    receipt_text = EXCLUDED.receipt_text,
    action = EXCLUDED.action,
    ingredient_id = EXCLUDED.ingredient_id,
    units_per_item = EXCLUDED.units_per_item
  RETURNING m.id INTO v_id;

  RETURN v_id;
END;
$function$;

COMMENT ON FUNCTION remember_receipt_line_mapping(uuid, text, text, uuid, numeric) IS
  'Create or replace the memory row for a supplier and receipt line text. action ingredient needs an ingredient and units per receipt item; skip needs neither. Invoker. Requires owner or partner.';

REVOKE ALL ON FUNCTION remember_receipt_line_mapping(uuid, text, text, uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION remember_receipt_line_mapping(uuid, text, text, uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION remember_receipt_line_mapping(uuid, text, text, uuid, numeric) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. match_receipt_lines — one output row per input text, in input order.
--    Unknown text: action, ingredient_id and units_per_item are NULL.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION match_receipt_lines(
  p_supplier_id uuid,
  p_texts text[]
)
RETURNS TABLE (
  line_index integer,
  text_key text,
  action text,
  ingredient_id uuid,
  units_per_item numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $function$
#variable_conflict use_column
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_texts IS NULL THEN
    RETURN;
  END IF;

  IF cardinality(p_texts) > 200 THEN
    RAISE EXCEPTION 'At most 200 receipt lines can be matched at once.';
  END IF;

  RETURN QUERY
  SELECT
    t.ord::integer,
    receipt_line_text_key(t.txt),
    m.action,
    m.ingredient_id,
    m.units_per_item::numeric
  FROM unnest(p_texts) WITH ORDINALITY AS t(txt, ord)
  LEFT JOIN receipt_line_mappings AS m
    ON m.supplier_id = p_supplier_id
   AND m.text_key = receipt_line_text_key(t.txt)
  ORDER BY t.ord;
END;
$function$;

COMMENT ON FUNCTION match_receipt_lines(uuid, text[]) IS
  'For each receipt line text (1-based line_index), the remembered action for this supplier, or NULLs when unknown. Invoker. Requires owner or partner.';

REVOKE ALL ON FUNCTION match_receipt_lines(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION match_receipt_lines(uuid, text[]) FROM anon;
GRANT EXECUTE ON FUNCTION match_receipt_lines(uuid, text[]) TO authenticated;
