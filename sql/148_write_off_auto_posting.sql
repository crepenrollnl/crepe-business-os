-- sql/148 — audit D2/K3, step 2: write-off journals are posted by the
-- DATABASE at COMMIT, like sale journals since sql/147.
--
-- Why: today the browser posts write-offs with a RANDOM business_event_id,
-- so a retry or a re-post would double the expense, and a closed tablet
-- leaves the write-off without a journal.
--
-- Rules reproduced 1:1 from the app (write-off-posting-rule.ts,
-- write-off-accounting-service.ts), with stable ids:
--   single write-off (record_write_off):
--     key  'waste_recognized:' || write_offs.id      (the app's key string)
--   dish write-off (record_dish_write_off) — one journal per item type:
--     key  'waste_recognized:dish:' || item_type || ':' || dish_write_off_id
--     amount = sum of the group's rows (ingredient group / finished-goods group)
--   amount  round(total_value, 2) — the same value on transaction and base
--           side (the app sent unrounded 4-decimal transaction amounts, which
--           could be rejected on half cents); 0.00 after rounding → nothing
--           posted, no failure (as the app: sub-cent write-offs are skipped)
--   lines   Dr waste_expense (6150) 'Waste & Spoilage'
--           Cr inventory_asset (1100) 'Raw Material Inventory'       (ingredient)
--           Cr finished_goods_inventory (1110) 'Finished Goods Inventory' (finished_good)
--   memo    'Write-off: Dr waste_expense / Cr inventory_asset' (or … / Cr finished_goods_inventory)
--   date    UTC calendar day of write_offs.created_at (like sales in sql/147)
--   failure → posting_failures (source 'write_off_record', entity 'write_off',
--             entity_id = the row, stable business_event_id); the write-off stays.
--
-- Pieces:
--   1. write_offs.dish_write_off_id (nullable) + record_dish_write_off sets it
--      (one id per call). The function body is otherwise unchanged (it must
--      equal sql/136 before this runs — checked).
--   2. post_journal_by_roles(key, date, memo, lines) — generic internal poster
--      (also for production / purchases later): roles → accounts on the date,
--      open fiscal period, company currency, rate 1, zero lines skipped,
--      post_journal_proposals_internal (sql/147). Not callable by clients.
--   3. post_write_off_journals(write_off_id) — builds the journal for that
--      row (or its dish group). Not callable by clients.
--   4. DEFERRED constraint trigger AFTER INSERT ON write_offs → at COMMIT.
--
-- Old write-offs posted by the app are NOT re-posted (no backfill): the app
-- used random ids, so the database cannot recognise them.
-- The app must stop posting write-offs (code PR) BEFORE this runs on PROD,
-- otherwise both would post with different ids.

-- ---------------------------------------------------------------------------
-- 1. dish_write_off_id + record_dish_write_off
-- ---------------------------------------------------------------------------
ALTER TABLE public.write_offs ADD COLUMN IF NOT EXISTS dish_write_off_id uuid;
CREATE INDEX IF NOT EXISTS write_offs_dish_write_off_id_idx
  ON public.write_offs (dish_write_off_id) WHERE dish_write_off_id IS NOT NULL;
COMMENT ON COLUMN public.write_offs.dish_write_off_id IS
  'Same value on every row written by one record_dish_write_off call (sql/148). NULL for a single write-off. Groups the rows into one journal per item type.';

DO $pre148$
DECLARE
  v_src text;
BEGIN
  SELECT replace(prosrc, chr(13), '') INTO v_src
  FROM pg_proc
  WHERE oid = to_regprocedure('public.record_dish_write_off(uuid, numeric, text, text)');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'sql/148 precheck: record_dish_write_off not found';
  END IF;
  IF position('-- sql/148' IN v_src) = 0
     AND md5(v_src) <> '4bf2b5869b131382bd8e1d5b6cdcf593' THEN
    RAISE EXCEPTION 'sql/148 precheck: live record_dish_write_off differs from sql/136 (md5 %) — stop and review', md5(v_src);
  END IF;
END;
$pre148$;

-- sql/136 body + two marked sql/148 additions (v_group, UPDATE before RETURN).
CREATE OR REPLACE FUNCTION public.record_dish_write_off(
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_name text;
  v_role text;
  v_quantity numeric(12, 3);
  v_user_note text;
  v_note text;
  v_part record;
  v_part_name text;
  v_required numeric;
  v_result jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_count integer := 0;
  v_group uuid := gen_random_uuid();  -- sql/148: one id for all rows of this dish write-off
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'Choose a dish to write off.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Write-off quantity must be greater than zero.';
  END IF;

  v_quantity := round(p_quantity, 3);

  IF v_quantity <= 0 OR v_quantity > 1000 THEN
    RAISE EXCEPTION 'Dish quantity must be between 0.001 and 1000.';
  END IF;

  IF p_reason IS NULL OR p_reason NOT IN (
    'spoilage',
    'damaged',
    'quality_reject',
    'staff_use',
    'theft',
    'other'
  ) THEN
    RAISE EXCEPTION 'Write-off reason is invalid.';
  END IF;

  SELECT name, recipe_role
  INTO v_name, v_role
  FROM recipes
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dish was not found.';
  END IF;

  IF v_role IS DISTINCT FROM 'assembly' THEN
    RAISE EXCEPTION
      '"%" is not a dish. Write off components under Finished Goods.',
      v_name;
  END IF;

  v_user_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_note := 'Dish: ' || v_name || ' × ' || trim_scale(v_quantity)::text
    || CASE WHEN v_user_note IS NULL THEN '' ELSE ' — ' || v_user_note END;

  FOR v_part IN
    SELECT
      rc.component_recipe_id,
      rc.ingredient_id,
      rc.quantity AS bom_quantity,
      r.name AS component_name,
      ing.name AS ingredient_name
    FROM recipe_components rc
    LEFT JOIN recipes r ON r.id = rc.component_recipe_id
    LEFT JOIN ingredients ing ON ing.id = rc.ingredient_id
    WHERE rc.assembly_recipe_id = p_product_id
    ORDER BY rc.id
  LOOP
    v_part_name := COALESCE(v_part.component_name, v_part.ingredient_name, 'part');
    v_required := round(v_part.bom_quantity * v_quantity, 3);

    IF v_required <= 0 THEN
      RAISE EXCEPTION
        'Quantity is too small: "%" in "%" would round to zero.',
        v_part_name,
        v_name;
    END IF;

    BEGIN
      IF v_part.component_recipe_id IS NOT NULL THEN
        v_result := record_write_off(
          'finished_good',
          NULL,
          v_part.component_recipe_id,
          v_required,
          p_reason,
          v_note
        );
      ELSE
        v_result := record_write_off(
          'ingredient',
          v_part.ingredient_id,
          NULL,
          v_required,
          p_reason,
          v_note
        );
      END IF;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION
          'Could not write off "%" for dish "%": %',
          v_part_name,
          v_name,
          SQLERRM;
    END;

    v_rows := v_rows || jsonb_build_array(v_result);
    v_total := v_total + COALESCE((v_result ->> 'total_value')::numeric, 0);
    v_count := v_count + 1;
  END LOOP;

  IF v_count = 0 THEN
    RAISE EXCEPTION
      'Dish "%" has no components defined and cannot be written off.',
      v_name;
  END IF;

  -- sql/148: mark every row of this call as one dish write-off, so the
  -- database posts one journal per item type for the whole dish.
  UPDATE write_offs
  SET dish_write_off_id = v_group
  WHERE id IN (
    SELECT (r ->> 'id')::uuid FROM jsonb_array_elements(v_rows) AS r
  );

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'quantity', v_quantity,
    'total_value', round(v_total, 4),
    'write_offs', v_rows
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.record_dish_write_off(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_dish_write_off(uuid, numeric, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. post_journal_by_roles (generic internal poster)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_journal_by_roles(
  p_key text,
  p_date date,
  p_memo text,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_currency text;
  v_period uuid;
  v_entry_id uuid := gen_random_uuid();
  v_lines jsonb := '[]'::jsonb;
  v_ledger jsonb := '[]'::jsonb;
  v_line jsonb;
  v_line_no integer := 0;
  v_line_id uuid;
  v_account uuid;
  v_amount numeric;
  v_debit numeric;
  v_credit numeric;
BEGIN
  IF p_key IS NULL OR p_date IS NULL OR p_lines IS NULL THEN
    RAISE EXCEPTION 'post_journal_by_roles: key, date and lines are required.';
  END IF;

  SELECT currency_code INTO v_currency FROM company_settings LIMIT 1;
  IF v_currency IS NULL THEN
    RAISE EXCEPTION 'Company currency is not set.';
  END IF;

  SELECT id INTO v_period
  FROM fiscal_periods
  WHERE status = 'open' AND p_date BETWEEN start_date AND end_date
  ORDER BY start_date
  LIMIT 1;
  IF v_period IS NULL THEN
    RAISE EXCEPTION 'No open fiscal period covers %.', p_date;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    v_amount := round(COALESCE((v_line ->> 'amount')::numeric, 0), 2);
    CONTINUE WHEN v_amount = 0;
    IF v_amount < 0 THEN
      RAISE EXCEPTION 'post_journal_by_roles: negative amount for role %.', v_line ->> 'role';
    END IF;

    v_account := sale_posting_account(v_line ->> 'role', p_date);
    v_debit := CASE WHEN v_line ->> 'side' = 'debit' THEN v_amount ELSE 0 END;
    v_credit := CASE WHEN v_line ->> 'side' = 'credit' THEN v_amount ELSE 0 END;
    IF v_debit = 0 AND v_credit = 0 THEN
      RAISE EXCEPTION 'post_journal_by_roles: side must be debit or credit.';
    END IF;

    v_line_no := v_line_no + 1;
    v_line_id := gen_random_uuid();
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', v_line_id, 'journal_entry_id', v_entry_id, 'line_no', v_line_no,
      'account_id', v_account, 'description', v_line ->> 'description',
      'debit_transaction', v_debit, 'credit_transaction', v_credit,
      'debit_base', v_debit, 'credit_base', v_credit, 'tax_code', NULL));
    v_ledger := v_ledger || jsonb_build_array(jsonb_build_object(
      'id', gen_random_uuid(), 'journal_entry_id', v_entry_id, 'journal_line_id', v_line_id,
      'fiscal_period_id', v_period, 'account_id', v_account, 'entry_date', p_date,
      'debit_base', v_debit, 'credit_base', v_credit,
      'debit_transaction', v_debit, 'credit_transaction', v_credit,
      'transaction_currency', v_currency, 'base_currency', v_currency));
  END LOOP;

  IF v_line_no = 0 THEN
    RETURN jsonb_build_object('status', 'nothing_to_post');
  END IF;

  RETURN jsonb_build_object(
    'status', 'done',
    'results', post_journal_proposals_internal(
      jsonb_build_array(jsonb_build_object(
        'journal_entry', jsonb_build_object(
          'id', v_entry_id,
          'business_event_id', stable_business_event_id(p_key),
          'transaction_id', NULL,
          'fiscal_period_id', v_period,
          'entry_date', p_date,
          'memo', p_memo,
          'status', 'posted',
          'posting_number', NULL,
          'transaction_currency', v_currency,
          'base_currency', v_currency,
          'exchange_rate', 1,
          'reversal_of_journal_entry_id', NULL,
          'posted_at', v_now,
          'created_at', v_now),
        'journal_lines', v_lines,
        'ledger_entries', v_ledger)),
      p_date, v_now));
END;
$function$;

REVOKE ALL ON FUNCTION public.post_journal_by_roles(text, date, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. post_write_off_journals
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.write_off_posting_key(p_write_off_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN w.dish_write_off_id IS NULL THEN 'waste_recognized:' || w.id
    ELSE 'waste_recognized:dish:' || w.item_type || ':' || w.dish_write_off_id
  END
  FROM write_offs w
  WHERE w.id = p_write_off_id;
$function$;

REVOKE ALL ON FUNCTION public.write_off_posting_key(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.post_write_off_journals(p_write_off_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row write_offs%ROWTYPE;
  v_amount numeric;
  v_credit_role text;
  v_credit_desc text;
BEGIN
  SELECT * INTO v_row FROM write_offs WHERE id = p_write_off_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Write-off % was not found.', p_write_off_id;
  END IF;

  IF v_row.dish_write_off_id IS NULL THEN
    v_amount := round(COALESCE(v_row.total_value, 0), 2);
  ELSE
    SELECT round(COALESCE(SUM(w.total_value), 0), 2) INTO v_amount
    FROM write_offs w
    WHERE w.dish_write_off_id = v_row.dish_write_off_id
      AND w.item_type = v_row.item_type;
  END IF;

  IF v_amount <= 0 THEN
    RETURN jsonb_build_object('status', 'nothing_to_post', 'amount', v_amount);
  END IF;

  IF v_row.item_type = 'finished_good' THEN
    v_credit_role := 'finished_goods_inventory';
    v_credit_desc := 'Finished Goods Inventory';
  ELSE
    v_credit_role := 'inventory_asset';
    v_credit_desc := 'Raw Material Inventory';
  END IF;

  RETURN post_journal_by_roles(
    write_off_posting_key(p_write_off_id),
    (v_row.created_at AT TIME ZONE 'UTC')::date,
    'Write-off: Dr waste_expense / Cr ' || v_credit_role,
    jsonb_build_array(
      jsonb_build_object('role', 'waste_expense', 'side', 'debit',
                         'amount', v_amount, 'description', 'Waste & Spoilage'),
      jsonb_build_object('role', v_credit_role, 'side', 'credit',
                         'amount', v_amount, 'description', v_credit_desc)));
END;
$function$;

REVOKE ALL ON FUNCTION public.post_write_off_journals(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Deferred trigger: post at commit, never undo the write-off
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.write_offs_auto_post_journals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  BEGIN
    PERFORM post_write_off_journals(NEW.id);
  EXCEPTION
    WHEN OTHERS THEN
      INSERT INTO posting_failures (
        source_flow, entity_type, entity_id, business_event_id, error_message
      )
      VALUES (
        'write_off_record', 'write_off', NEW.id,
        stable_business_event_id(COALESCE(write_off_posting_key(NEW.id), 'waste_recognized:' || NEW.id)),
        'Automatic posting failed: ' || SQLERRM
      );
  END;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.write_offs_auto_post_journals() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS write_offs_auto_post_journals ON public.write_offs;
CREATE CONSTRAINT TRIGGER write_offs_auto_post_journals
  AFTER INSERT ON public.write_offs
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.write_offs_auto_post_journals();
