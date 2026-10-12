-- sql/145 — audit S2 + S3, step 2: the 13 RPCs that the app calls from
-- seller-reachable screens now require an active profile (owner, partner or
-- seller). Before this, any signed-in user WITHOUT a profiles row (and anon,
-- where it still had EXECUTE) could create and confirm sales, consume stock,
-- write posting_failures and read company settings / sales reports.
--
-- Nothing changes for owner, partner or seller.
--
-- How: for each function below, the CURRENT definition (pg_get_functiondef)
-- gets exactly one new line right after its top-level BEGIN:
--     PERFORM require_role('owner', 'partner', 'seller');  -- sql/145
-- No other character of any body is touched. The block checks, for every
-- function, that:
--   - it exists, is plpgsql, SECURITY DEFINER, and has exactly one top-level
--     BEGIN line and no require_role yet;
--   - after the rewrite, the body minus that one line is byte-for-byte the
--     old body, it is still SECURITY DEFINER, and the guard appears once.
-- Re-running skips functions that already carry the sql/145 line.
--
-- Grants: EXECUTE is revoked from PUBLIC and anon and granted to
-- authenticated explicitly (so authenticated keeps it even where it had it
-- only through PUBLIC).
--
-- Roles stay 'owner', 'partner', 'seller' for get_reporting_workspace and
-- get_sales_by_product for now; hiding reports from sellers is audit S4/U5.

DO $g145$
DECLARE
  v_targets text[] := ARRAY[
    'create_and_confirm_sale(uuid, jsonb, text, text, numeric, uuid)',
    'create_draft_sale(uuid, text, text, uuid)',
    'add_sale_line(uuid, uuid, numeric, numeric)',
    'update_sale_line(uuid, numeric)',
    'delete_sale_line(uuid)',
    'confirm_sale(uuid)',
    'set_sale_paid_flag(uuid, boolean)',
    'record_posting_failure(text, text, uuid, uuid, text)',
    'get_company_settings()',
    'verify_sale_cost_and_profit(uuid, numeric, numeric, numeric, numeric)',
    'get_inventory_movement_history_by_ingredient(uuid)',
    'get_reporting_workspace()',
    'get_sales_by_product(timestamp with time zone, timestamp with time zone)'
  ];
  v_guard constant text := 'PERFORM require_role(''owner'', ''partner'', ''seller'');  -- sql/145';
  v_sig text;
  v_oid oid;
  v_lang text;
  v_secdef boolean;
  v_old_src text;
  v_new_src text;
  v_def text;
  v_new_def text;
  v_cr text;
BEGIN
  FOREACH v_sig IN ARRAY v_targets
  LOOP
    v_oid := to_regprocedure('public.' || v_sig);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'sql/145: function public.% not found', v_sig;
    END IF;

    SELECT l.lanname, p.prosecdef, p.prosrc
    INTO v_lang, v_secdef, v_old_src
    FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
    WHERE p.oid = v_oid;

    IF position('-- sql/145' IN v_old_src) > 0 THEN
      CONTINUE;  -- already guarded by an earlier run
    END IF;

    IF v_lang <> 'plpgsql' OR NOT v_secdef THEN
      RAISE EXCEPTION 'sql/145: % is % / secdef=% (expected plpgsql SECURITY DEFINER)',
        v_sig, v_lang, v_secdef;
    END IF;
    IF position('require_role' IN v_old_src) > 0 THEN
      RAISE EXCEPTION 'sql/145: % already calls require_role — review by hand', v_sig;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_old_src, '^BEGIN\r?$', 'gn')) <> 1 THEN
      RAISE EXCEPTION 'sql/145: % does not have exactly one top-level BEGIN line', v_sig;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    IF (SELECT count(*) FROM regexp_matches(v_def, '^BEGIN\r?$', 'gn')) <> 1 THEN
      RAISE EXCEPTION 'sql/145: % definition does not have exactly one BEGIN line', v_sig;
    END IF;
    v_cr := CASE WHEN v_old_src ~ '\nBEGIN\r\n' THEN E'\r' ELSE '' END;

    v_new_def := regexp_replace(
      v_def,
      '^BEGIN(\r?)$',
      'BEGIN\1' || E'\n' || '  ' || v_guard || v_cr,
      'n'
    );
    EXECUTE v_new_def;

    SELECT p.prosrc INTO v_new_src FROM pg_proc p WHERE p.oid = v_oid;
    IF replace(v_new_src, E'\n  ' || v_guard || v_cr, '') IS DISTINCT FROM v_old_src
       OR (SELECT count(*) FROM regexp_matches(v_new_src, '-- sql/145', 'g')) <> 1
       OR NOT (SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_oid) THEN
      RAISE EXCEPTION 'sql/145: rewrite of % changed more than the guard line', v_sig;
    END IF;

    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', v_sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', v_sig);
  END LOOP;
END;
$g145$;
