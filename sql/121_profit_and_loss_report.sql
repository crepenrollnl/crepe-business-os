-- Profit and Loss report from posted General Ledger facts.
-- Run in Supabase SQL editor after sql/120 (and after sql/081 + sql/115
-- so accounts 4000/5000/6010–6140/6150/6200 exist).
-- Apply on both databases (dev + prod), as with every previous sql/*.sql.
--
-- Read-only SECURITY DEFINER RPC. Owner/partner only (same gate as
-- record_write_off in sql/117). Never writes journals, ledger, sales, or
-- write_offs.
--
-- P&L amounts come only from ledger_entries (entry_date inclusive) joined
-- to accounts.code. Operating-expense codes are the Group 2 seed in
-- sql/081 (6010–6140). 6150 (sql/115 Waste & Spoilage) and 6200 (sql/081
-- Group 3 Depreciation Expense) are separate lines, not opex.
--
-- Reconciliation compares those ledger totals to operational tables
-- because confirm_sale / record_write_off post GL in a later TS step, not
-- in the same SQL transaction:
--   sales_revenue — SUM(sales.subtotal) for status IN ('confirmed', 'paid')
--                   whose confirmed_at::date is inside the period
--                   (subtotal is the field sale-accounting posts to 4000;
--                   paid replaces confirmed, so both must count)
--   cogs          — SUM(finished_goods_batch_consumptions.total_cost)
--                   + SUM(stock_movements.quantity * unit_cost) for those
--                   same confirmed/paid sales (sql/109 grain; sales has no
--                   total_cogs column)
--   write_offs    — SUM(write_offs.total_value) whose created_at::date
--                   is inside the period (write_offs has no status column)
-- mismatch is true when abs(operational − ledger) > 0.01.
--
-- Does NOT:
--   - change accounts / journal / ledger / sales / write_offs schema
--   - post or reverse journals
--   - invent a sales.total_cogs column
--   - touch UI

CREATE OR REPLACE FUNCTION get_profit_and_loss(
  p_period_start date,
  p_period_end date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_required_codes text[] := ARRAY[
    '4000',
    '5000',
    '6010',
    '6020',
    '6030',
    '6040',
    '6050',
    '6060',
    '6070',
    '6080',
    '6090',
    '6100',
    '6110',
    '6120',
    '6130',
    '6140',
    '6150',
    '6200'
  ];
  v_opex_codes text[] := ARRAY[
    '6010',
    '6020',
    '6030',
    '6040',
    '6050',
    '6060',
    '6070',
    '6080',
    '6090',
    '6100',
    '6110',
    '6120',
    '6130',
    '6140'
  ];
  v_missing text;
  v_revenue numeric(18, 2);
  v_cogs numeric(18, 2);
  v_gross_profit numeric(18, 2);
  v_opex numeric(18, 2);
  v_opex_breakdown jsonb;
  v_write_offs numeric(18, 2);
  v_depreciation numeric(18, 2);
  v_net_profit numeric(18, 2);
  v_op_revenue numeric(18, 2);
  v_op_cogs numeric(18, 2);
  v_op_write_offs numeric(18, 2);
BEGIN
  PERFORM require_role('owner', 'partner');

  IF p_period_start IS NULL OR p_period_end IS NULL THEN
    RAISE EXCEPTION 'Period start and period end are required.';
  END IF;

  IF p_period_end < p_period_start THEN
    RAISE EXCEPTION 'Period end must be on or after period start.';
  END IF;

  SELECT string_agg(required.code, ', ' ORDER BY required.code)
  INTO v_missing
  FROM unnest(v_required_codes) AS required(code)
  WHERE NOT EXISTS (
    SELECT 1
    FROM accounts a
    WHERE a.code = required.code
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'Required P&L account(s) missing from chart of accounts: %.',
      v_missing;
  END IF;

  SELECT round(COALESCE(SUM(le.credit_base - le.debit_base), 0), 2)
  INTO v_revenue
  FROM ledger_entries le
  JOIN accounts a ON a.id = le.account_id
  WHERE a.code = '4000'
    AND le.entry_date BETWEEN p_period_start AND p_period_end;

  SELECT round(COALESCE(SUM(le.debit_base - le.credit_base), 0), 2)
  INTO v_cogs
  FROM ledger_entries le
  JOIN accounts a ON a.id = le.account_id
  WHERE a.code = '5000'
    AND le.entry_date BETWEEN p_period_start AND p_period_end;

  v_gross_profit := round(v_revenue - v_cogs, 2);

  SELECT
    round(COALESCE(SUM(amounts.amount), 0), 2),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'account_code', amounts.code,
          'account_name', amounts.name,
          'amount', amounts.amount
        )
        ORDER BY amounts.code
      ) FILTER (WHERE amounts.amount <> 0),
      '[]'::jsonb
    )
  INTO v_opex, v_opex_breakdown
  FROM (
    SELECT
      a.code,
      a.name,
      round(COALESCE(SUM(le.debit_base - le.credit_base), 0), 2) AS amount
    FROM accounts a
    LEFT JOIN ledger_entries le
      ON le.account_id = a.id
      AND le.entry_date BETWEEN p_period_start AND p_period_end
    WHERE a.code = ANY (v_opex_codes)
    GROUP BY a.code, a.name
  ) amounts;

  SELECT round(COALESCE(SUM(le.debit_base - le.credit_base), 0), 2)
  INTO v_write_offs
  FROM ledger_entries le
  JOIN accounts a ON a.id = le.account_id
  WHERE a.code = '6150'
    AND le.entry_date BETWEEN p_period_start AND p_period_end;

  SELECT round(COALESCE(SUM(le.debit_base - le.credit_base), 0), 2)
  INTO v_depreciation
  FROM ledger_entries le
  JOIN accounts a ON a.id = le.account_id
  WHERE a.code = '6200'
    AND le.entry_date BETWEEN p_period_start AND p_period_end;

  v_net_profit := round(
    v_gross_profit - v_opex - v_write_offs - v_depreciation,
    2
  );

  SELECT round(COALESCE(SUM(s.subtotal), 0), 2)
  INTO v_op_revenue
  FROM sales s
  WHERE s.status IN ('confirmed', 'paid')
    AND s.confirmed_at IS NOT NULL
    AND s.confirmed_at::date BETWEEN p_period_start AND p_period_end;

  SELECT round(
    COALESCE((
      SELECT SUM(fgbc.total_cost)
      FROM finished_goods_batch_consumptions fgbc
      JOIN sale_lines sl ON sl.id = fgbc.source_id
      JOIN sales s ON s.id = sl.sale_id
      WHERE fgbc.source_type = 'sale_line'
        AND fgbc.direction = 'out'
        AND fgbc.reason = 'sale'
        AND s.status IN ('confirmed', 'paid')
        AND s.confirmed_at IS NOT NULL
        AND s.confirmed_at::date BETWEEN p_period_start AND p_period_end
    ), 0)
    +
    COALESCE((
      SELECT SUM(sm.quantity * sm.unit_cost)
      FROM stock_movements sm
      JOIN sale_lines sl ON sl.id = sm.reference_id
      JOIN sales s ON s.id = sl.sale_id
      WHERE sm.reference_type = 'sale'
        AND sm.movement_type = 'sale_out'
        AND s.status IN ('confirmed', 'paid')
        AND s.confirmed_at IS NOT NULL
        AND s.confirmed_at::date BETWEEN p_period_start AND p_period_end
    ), 0),
    2
  )
  INTO v_op_cogs;

  SELECT round(COALESCE(SUM(wo.total_value), 0), 2)
  INTO v_op_write_offs
  FROM write_offs wo
  WHERE wo.created_at::date BETWEEN p_period_start AND p_period_end;

  RETURN jsonb_build_object(
    'period_start', p_period_start,
    'period_end', p_period_end,
    'revenue', v_revenue,
    'cogs', v_cogs,
    'gross_profit', v_gross_profit,
    'opex_breakdown', v_opex_breakdown,
    'opex', v_opex,
    'write_offs', v_write_offs,
    'depreciation', v_depreciation,
    'net_profit', v_net_profit,
    'reconciliation', jsonb_build_object(
      'sales_revenue', jsonb_build_object(
        'operational_amount', v_op_revenue,
        'ledger_amount', v_revenue,
        'mismatch', abs(v_op_revenue - v_revenue) > 0.01
      ),
      'cogs', jsonb_build_object(
        'operational_amount', v_op_cogs,
        'ledger_amount', v_cogs,
        'mismatch', abs(v_op_cogs - v_cogs) > 0.01
      ),
      'write_offs', jsonb_build_object(
        'operational_amount', v_op_write_offs,
        'ledger_amount', v_write_offs,
        'mismatch', abs(v_op_write_offs - v_write_offs) > 0.01
      )
    )
  );
END;
$$;

COMMENT ON FUNCTION get_profit_and_loss(date, date) IS
  'Owner/partner P&L from ledger_entries for an inclusive date window, plus operational-vs-ledger reconciliation for confirmed/paid sales revenue, COGS, and write-offs.';

REVOKE ALL ON FUNCTION get_profit_and_loss(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_profit_and_loss(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION get_profit_and_loss(date, date) TO authenticated;
