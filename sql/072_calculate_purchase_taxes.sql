-- Calculate Purchase Taxes (V1 plan 1.6, step 3/3)
-- Run in Supabase SQL editor after sql/071_accounting_vat_netherlands_seed.sql.
--
-- Full server-side VAT calculation, replacing the in-browser Tax Engine /
-- Tax Integration / Country Pack pipeline (src/features/tax-engine,
-- tax-integration, tax-packs) for Purchases. Country-agnostic: adding a new
-- country later means inserting jurisdiction/definition/rate/rule rows
-- (sql/071-style seed), never editing this function.
--
-- Pipeline (mirrors src/features/tax-engine/utils/tax-pipeline.ts):
--   resolve jurisdiction by country_code
--   -> per line: resolve applicable tax_rules (jsonb attribute match,
--      effective date, highest priority per tax_code)
--   -> resolve effective tax_rate per matched definition
--   -> apply tax_types.application_method formula
--   -> round per jurisdiction rounding policy
--   -> aggregate per line and per tax_code, plus document totals
--
-- Does NOT:
--   - validate tax_definitions.tax_code uniqueness across the whole
--     configuration (a data-quality concern, not a per-request calculation)
--   - change purchases / purchase_items / tax_* schema
--   - touch src/features/tax-engine, tax-integration, tax-packs (unused,
--     kept as-is per the plan)

-- ---------------------------------------------------------------------------
-- tax_round: all 5 rounding modes as jurisdiction-selectable data, not code.
-- Mirrors src/features/tax-engine/utils/tax-rounding.ts exactly, except that
-- numeric (exact decimal) arithmetic here removes the binary floating point
-- edge cases the JS implementation is exposed to at the exact .5 boundary.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION tax_round(
  p_value numeric,
  p_mode text,
  p_decimal_places integer
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_factor numeric := power(10, p_decimal_places);
  v_scaled numeric;
  v_floor numeric;
  v_diff numeric;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;

  CASE p_mode
    WHEN 'half_up' THEN
      -- Postgres numeric round() is round-half-away-from-zero, equivalent to
      -- half_up for the non-negative money amounts VAT calculation produces.
      RETURN round(p_value, p_decimal_places);
    WHEN 'floor' THEN
      RETURN floor(p_value * v_factor) / v_factor;
    WHEN 'ceil' THEN
      RETURN ceil(p_value * v_factor) / v_factor;
    WHEN 'truncate' THEN
      RETURN trunc(p_value, p_decimal_places);
    WHEN 'half_even' THEN
      v_scaled := p_value * v_factor;
      v_floor := floor(v_scaled);
      v_diff := v_scaled - v_floor;
      IF v_diff > 0.5 THEN
        RETURN (v_floor + 1) / v_factor;
      ELSIF v_diff < 0.5 THEN
        RETURN v_floor / v_factor;
      ELSIF mod(v_floor, 2) = 0 THEN
        RETURN v_floor / v_factor;
      ELSE
        RETURN (v_floor + 1) / v_factor;
      END IF;
    ELSE
      RAISE EXCEPTION 'Unknown tax rounding mode: %', p_mode;
  END CASE;
END;
$$;

GRANT EXECUTE ON FUNCTION tax_round(numeric, text, integer) TO authenticated;

-- ---------------------------------------------------------------------------
-- calculate_purchase_taxes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION calculate_purchase_taxes(
  p_country text,
  p_transaction_date date,
  p_currency text,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_jurisdiction record;

  v_line jsonb;
  v_line_id text;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
  v_price_mode text;
  v_tax_category text;
  v_tax_regime text;
  v_requested_codes text[];
  v_missing_code text;
  v_attributes jsonb;
  v_amount numeric;

  v_resolved record;
  v_rate record;
  v_resolved_codes text[];
  v_any_resolved boolean;
  v_saw_inclusive boolean;

  v_taxable_base numeric;
  v_tax_amount numeric;
  v_net_amount numeric;
  v_gross_amount numeric;

  v_line_breakdown jsonb;
  v_line_net numeric;
  v_line_tax numeric;
  v_line_gross numeric;

  v_lines_out jsonb := '[]'::jsonb;
  v_by_tax_code jsonb := '{}'::jsonb;
  v_net_total numeric := 0;
  v_tax_total numeric := 0;
  v_gross_total numeric := 0;
BEGIN
  IF p_country IS NULL OR btrim(p_country) = '' THEN
    RAISE EXCEPTION 'Tax country is required.';
  END IF;
  IF p_transaction_date IS NULL THEN
    RAISE EXCEPTION 'Transaction date is required.';
  END IF;
  IF p_currency IS NULL OR btrim(p_currency) = '' THEN
    RAISE EXCEPTION 'Currency is required.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'At least one tax line is required.';
  END IF;

  SELECT id, code, country_code, rounding_mode, rounding_decimal_places
  INTO v_jurisdiction
  FROM tax_jurisdictions
  WHERE upper(country_code) = upper(btrim(p_country))
    AND is_active = true
  ORDER BY code
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active tax jurisdiction is registered for country ''%''.', p_country;
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines)
  LOOP
    BEGIN
      v_line_id := v_line ->> 'line_id';
      v_quantity := (v_line ->> 'quantity')::numeric;
      v_unit_price := (v_line ->> 'unit_price')::numeric;
      v_discount := COALESCE((v_line ->> 'discount')::numeric, 0);
      v_price_mode := COALESCE(v_line ->> 'price_mode', 'exclusive');
      v_tax_category := v_line ->> 'tax_category';
      v_tax_regime := v_line ->> 'tax_regime';
    EXCEPTION
      WHEN others THEN
        RAISE EXCEPTION 'One or more tax lines are invalid.';
    END;

    IF v_line_id IS NULL OR btrim(v_line_id) = ''
       OR v_quantity IS NULL OR v_quantity <= 0
       OR v_unit_price IS NULL OR v_unit_price < 0
       OR v_tax_category IS NULL OR btrim(v_tax_category) = ''
       OR v_price_mode NOT IN ('exclusive', 'inclusive')
    THEN
      RAISE EXCEPTION 'One or more tax lines are invalid.';
    END IF;

    -- Line taxable amount is money-precision (2dp), independent of the
    -- jurisdiction's tax rounding policy applied to tax amounts below.
    v_amount := round(v_quantity * v_unit_price - v_discount, 2);

    -- Opaque attribute bag for rule matching. attributes (if supplied) may
    -- override tax_category; tax_regime always wins over attributes.regime —
    -- mirrors map-tax-request.ts precedence exactly.
    v_attributes := jsonb_build_object('category', v_tax_category)
      || COALESCE(v_line -> 'attributes', '{}'::jsonb);
    IF v_tax_regime IS NOT NULL AND btrim(v_tax_regime) <> '' THEN
      v_attributes := v_attributes || jsonb_build_object('regime', btrim(v_tax_regime));
    END IF;

    v_requested_codes := NULL;
    IF v_line ? 'tax_codes' AND jsonb_typeof(v_line -> 'tax_codes') = 'array' THEN
      SELECT array_agg(DISTINCT btrim(elem))
      INTO v_requested_codes
      FROM jsonb_array_elements_text(v_line -> 'tax_codes') AS elem;
    END IF;

    v_line_net := 0;
    v_line_tax := 0;
    v_saw_inclusive := false;
    v_any_resolved := false;
    v_resolved_codes := ARRAY[]::text[];
    v_line_breakdown := '[]'::jsonb;

    -- Highest-priority rule per tax_code, for this jurisdiction and date,
    -- whose match attributes are a subset of the line's attributes.
    FOR v_resolved IN
      SELECT DISTINCT ON (d.tax_code)
        d.id AS definition_id,
        d.tax_code,
        d.direction,
        r.id AS rule_id,
        t.application_method
      FROM tax_rules r
      JOIN tax_definitions d ON d.id = r.tax_definition_id
      JOIN tax_types t ON t.id = d.type_id
      WHERE r.is_active = true
        AND r.effective_from <= p_transaction_date
        AND (r.effective_to IS NULL OR r.effective_to >= p_transaction_date)
        AND (r.jurisdiction_id IS NULL OR r.jurisdiction_id = v_jurisdiction.id)
        AND d.is_active = true
        AND d.jurisdiction_id = v_jurisdiction.id
        AND d.effective_from <= p_transaction_date
        AND (d.effective_to IS NULL OR d.effective_to >= p_transaction_date)
        AND t.is_active = true
        AND r.match <@ v_attributes
        AND (v_requested_codes IS NULL OR d.tax_code = ANY (v_requested_codes))
      ORDER BY d.tax_code, r.priority DESC, r.created_at DESC, r.id
    LOOP
      v_any_resolved := true;
      v_resolved_codes := array_append(v_resolved_codes, v_resolved.tax_code);

      SELECT id, rate_value
      INTO v_rate
      FROM tax_rates
      WHERE tax_definition_id = v_resolved.definition_id
        AND is_active = true
        AND effective_from <= p_transaction_date
        AND (effective_to IS NULL OR effective_to >= p_transaction_date)
      ORDER BY effective_from DESC, id
      LIMIT 1;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'No active tax rate is effective for tax code ''%'' on %.',
          v_resolved.tax_code, p_transaction_date;
      END IF;

      CASE v_resolved.application_method
        WHEN 'percentage_of_base' THEN
          IF v_price_mode = 'inclusive' THEN
            IF (1 + v_rate.rate_value) = 0 THEN
              v_taxable_base := v_amount;
              v_tax_amount := 0;
            ELSE
              v_taxable_base := v_amount / (1 + v_rate.rate_value);
              v_tax_amount := v_amount - v_taxable_base;
            END IF;
            v_net_amount := v_taxable_base;
            v_gross_amount := v_amount;
          ELSE
            v_taxable_base := v_amount;
            v_tax_amount := v_amount * v_rate.rate_value;
            v_net_amount := v_amount;
            v_gross_amount := v_amount + v_tax_amount;
          END IF;
        WHEN 'percentage_of_gross' THEN
          v_taxable_base := v_amount;
          v_tax_amount := v_amount * v_rate.rate_value;
          v_net_amount := v_amount - v_tax_amount;
          v_gross_amount := v_amount;
        WHEN 'fixed_amount' THEN
          v_tax_amount := v_rate.rate_value;
          IF v_price_mode = 'inclusive' THEN
            v_taxable_base := v_amount - v_tax_amount;
            v_net_amount := v_amount - v_tax_amount;
            v_gross_amount := v_amount;
          ELSE
            v_taxable_base := v_amount;
            v_net_amount := v_amount;
            v_gross_amount := v_amount + v_tax_amount;
          END IF;
        WHEN 'amount_per_quantity' THEN
          v_tax_amount := v_rate.rate_value * v_quantity;
          IF v_price_mode = 'inclusive' THEN
            v_taxable_base := v_amount - v_tax_amount;
            v_net_amount := v_amount - v_tax_amount;
            v_gross_amount := v_amount;
          ELSE
            v_taxable_base := v_amount;
            v_net_amount := v_amount;
            v_gross_amount := v_amount + v_tax_amount;
          END IF;
        ELSE
          RAISE EXCEPTION 'Unsupported tax application method: %', v_resolved.application_method;
      END CASE;

      v_taxable_base := tax_round(v_taxable_base, v_jurisdiction.rounding_mode, v_jurisdiction.rounding_decimal_places);
      v_tax_amount := tax_round(v_tax_amount, v_jurisdiction.rounding_mode, v_jurisdiction.rounding_decimal_places);
      v_net_amount := tax_round(v_net_amount, v_jurisdiction.rounding_mode, v_jurisdiction.rounding_decimal_places);
      v_gross_amount := tax_round(v_gross_amount, v_jurisdiction.rounding_mode, v_jurisdiction.rounding_decimal_places);

      v_line_breakdown := v_line_breakdown || jsonb_build_object(
        'tax_code', v_resolved.tax_code,
        'tax_definition_id', v_resolved.definition_id,
        'tax_rule_id', v_resolved.rule_id,
        'tax_rate_id', v_rate.id,
        'jurisdiction_id', v_jurisdiction.id,
        'direction', v_resolved.direction,
        'application_method', v_resolved.application_method,
        'taxable_base', v_taxable_base,
        'rate_value', v_rate.rate_value,
        'tax_amount', v_tax_amount,
        'net_amount', v_net_amount,
        'gross_amount', v_gross_amount
      );

      IF v_price_mode = 'inclusive' THEN
        v_saw_inclusive := true;
      END IF;
      -- Matches tax-pipeline.ts: each application overwrites lineNet with its
      -- own netAmount (not summed), while lineTax accumulates across taxes.
      v_line_net := v_net_amount;
      v_line_tax := v_line_tax + v_tax_amount;

      v_by_tax_code := jsonb_set(
        v_by_tax_code,
        ARRAY[v_resolved.tax_code],
        to_jsonb(
          tax_round(
            COALESCE((v_by_tax_code ->> v_resolved.tax_code)::numeric, 0) + v_tax_amount,
            v_jurisdiction.rounding_mode,
            v_jurisdiction.rounding_decimal_places
          )
        )
      );
    END LOOP;

    IF v_requested_codes IS NOT NULL THEN
      FOREACH v_missing_code IN ARRAY v_requested_codes
      LOOP
        IF NOT (v_missing_code = ANY (v_resolved_codes)) THEN
          RAISE EXCEPTION 'No active tax rule matched requested tax code ''%'' for line ''%''.',
            v_missing_code, v_line_id;
        END IF;
      END LOOP;
    END IF;

    IF NOT v_any_resolved THEN
      -- No taxes matched — pass the exclusive amount through as net/gross.
      v_line_net := tax_round(v_amount, v_jurisdiction.rounding_mode, v_jurisdiction.rounding_decimal_places);
      v_line_gross := v_line_net;
      v_line_tax := 0;
    ELSIF v_saw_inclusive THEN
      v_line_gross := tax_round(v_amount, v_jurisdiction.rounding_mode, v_jurisdiction.rounding_decimal_places);
    ELSE
      v_line_gross := tax_round(v_line_net + v_line_tax, v_jurisdiction.rounding_mode, v_jurisdiction.rounding_decimal_places);
    END IF;

    v_net_total := v_net_total + v_line_net;
    v_tax_total := v_tax_total + v_line_tax;
    v_gross_total := v_gross_total + v_line_gross;

    v_lines_out := v_lines_out || jsonb_build_object(
      'line_id', v_line_id,
      'taxable_amount', v_line_net,
      'tax_amount', v_line_tax,
      'net_amount', v_line_net,
      'gross_amount', v_line_gross,
      'taxes', v_line_breakdown
    );
  END LOOP;

  v_net_total := tax_round(v_net_total, v_jurisdiction.rounding_mode, v_jurisdiction.rounding_decimal_places);
  v_tax_total := tax_round(v_tax_total, v_jurisdiction.rounding_mode, v_jurisdiction.rounding_decimal_places);
  v_gross_total := tax_round(v_gross_total, v_jurisdiction.rounding_mode, v_jurisdiction.rounding_decimal_places);

  RETURN jsonb_build_object(
    'country', upper(btrim(p_country)),
    'jurisdiction_id', v_jurisdiction.id,
    'jurisdiction_code', v_jurisdiction.code,
    'currency', p_currency,
    'transaction_date', p_transaction_date,
    'rounding', jsonb_build_object(
      'mode', v_jurisdiction.rounding_mode,
      'decimal_places', v_jurisdiction.rounding_decimal_places
    ),
    'subtotal', v_net_total,
    'tax_total', v_tax_total,
    'grand_total', v_gross_total,
    'effective_tax_rate',
      CASE WHEN v_net_total > 0 THEN round(v_tax_total / v_net_total, 6) ELSE 0 END,
    'lines', v_lines_out,
    'by_tax_code', v_by_tax_code,
    'is_valid', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION calculate_purchase_taxes(text, date, text, jsonb) TO authenticated;
