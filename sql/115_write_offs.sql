-- Write-offs: physical waste of raw materials and finished goods.
--
-- Run in Supabase SQL editor after sql/087, sql/091, sql/025, sql/074,
-- sql/080, and sql/081.
-- Apply on both databases (dev + prod), as with every previous sql/*.sql.
--
-- Adds:
--   write_offs table
--   record_write_off(...) SECURITY DEFINER
--   account 6150 Waste & Spoilage + waste_expense binding
--   stock_movements.reference_type += write_off
--   audit_log UNION ALL branch for write_offs
--
-- Physical stock:
--   ingredients  -> PERFORM decrement_ingredient_stock (sql/007) +
--                   stock_movements waste_out / write_off
--   finished goods -> allocate_finished_goods_fifo(..., 'waste',
--                   'waste_ticket', write_off.id) (sql/087)
-- Journal posting is NOT in this RPC. TS builds a waste_recognized
-- proposal and calls post_journal_proposals after success (same as
-- Production / Sales).
--
-- Does NOT:
--   - change decrement_ingredient_stock
--   - change allocate_finished_goods_fifo
--   - write journal_entries / ledger_entries
--   - add a sidebar module

-- ---------------------------------------------------------------------------
-- 1. write_offs
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS write_offs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL
    CHECK (item_type IN ('ingredient', 'finished_good')),
  ingredient_id uuid REFERENCES ingredients (id),
  product_id uuid REFERENCES recipes (id),
  quantity numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(12, 4) NOT NULL DEFAULT 0,
  total_value numeric(14, 4) NOT NULL DEFAULT 0,
  reason text NOT NULL
    CHECK (
      reason IN (
        'spoilage',
        'damaged',
        'quality_reject',
        'staff_use',
        'theft',
        'other'
      )
    ),
  note text,
  created_by uuid REFERENCES auth.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT write_offs_item_target_chk CHECK (
    (
      item_type = 'ingredient'
      AND ingredient_id IS NOT NULL
      AND product_id IS NULL
    )
    OR (
      item_type = 'finished_good'
      AND product_id IS NOT NULL
      AND ingredient_id IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS write_offs_created_at_idx
  ON write_offs (created_at DESC);
CREATE INDEX IF NOT EXISTS write_offs_reason_idx
  ON write_offs (reason);

COMMENT ON TABLE write_offs IS
  'Immutable physical write-offs of raw materials or finished goods. Stock mutation is owned by record_write_off; journals are posted in TS via post_journal_proposals.';

ALTER TABLE write_offs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'write_offs'
      AND policyname = 'write_offs_authenticated_all'
  ) THEN
    CREATE POLICY write_offs_authenticated_all
      ON write_offs FOR ALL TO authenticated
      USING (true) WITH CHECK (true);
  END IF;
END $$;

REVOKE ALL ON TABLE write_offs FROM PUBLIC;
REVOKE ALL ON TABLE write_offs FROM anon;
GRANT SELECT ON TABLE write_offs TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. stock_movements.reference_type += write_off
-- ---------------------------------------------------------------------------

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_reference_type_check;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_reference_type_check
  CHECK (
    reference_type IN (
      'purchase',
      'sale',
      'production_order',
      'production_session',
      'stock_movement',
      'payment',
      'manual',
      'event',
      'write_off'
    )
  );

-- ---------------------------------------------------------------------------
-- 3. record_write_off
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION record_write_off(
  p_item_type text,
  p_ingredient_id uuid,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_unit_cost numeric(12, 4) := 0;
  v_total_value numeric(14, 4) := 0;
  v_allocation jsonb;
  v_ingredient_name text;
BEGIN
  IF p_item_type IS NULL OR p_item_type NOT IN ('ingredient', 'finished_good') THEN
    RAISE EXCEPTION 'Write-off item type must be ingredient or finished_good.';
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

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Write-off quantity must be greater than zero.';
  END IF;

  IF p_item_type = 'ingredient' THEN
    IF p_ingredient_id IS NULL OR p_product_id IS NOT NULL THEN
      RAISE EXCEPTION 'An ingredient write-off requires ingredient_id and no product_id.';
    END IF;

    SELECT name, COALESCE(cost_per_unit, 0)
    INTO v_ingredient_name, v_unit_cost
    FROM ingredients
    WHERE id = p_ingredient_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ingredient not found: %', p_ingredient_id;
    END IF;

    PERFORM decrement_ingredient_stock(p_ingredient_id, p_quantity);

    v_total_value := round(p_quantity * v_unit_cost, 4);

    INSERT INTO stock_movements (
      ingredient_id,
      product_id,
      movement_type,
      quantity,
      unit_cost,
      transaction_id,
      reference_type,
      reference_id,
      occurred_at,
      created_at
    )
    VALUES (
      p_ingredient_id,
      NULL,
      'waste_out',
      p_quantity,
      v_unit_cost,
      NULL,
      'write_off',
      v_id,
      v_now,
      v_now
    );

    INSERT INTO write_offs (
      id,
      item_type,
      ingredient_id,
      product_id,
      quantity,
      unit_cost,
      total_value,
      reason,
      note,
      created_by,
      created_at
    )
    VALUES (
      v_id,
      'ingredient',
      p_ingredient_id,
      NULL,
      p_quantity,
      v_unit_cost,
      v_total_value,
      p_reason,
      v_note,
      auth.uid(),
      v_now
    );
  ELSE
    IF p_product_id IS NULL OR p_ingredient_id IS NOT NULL THEN
      RAISE EXCEPTION 'A finished-good write-off requires product_id and no ingredient_id.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM recipes WHERE id = p_product_id) THEN
      RAISE EXCEPTION 'Product was not found.';
    END IF;

    v_allocation := allocate_finished_goods_fifo(
      p_product_id,
      p_quantity,
      'waste',
      'waste_ticket',
      v_id,
      v_note,
      auth.uid()
    );

    v_total_value := COALESCE((v_allocation ->> 'total_cost')::numeric, 0);
    IF p_quantity > 0 THEN
      v_unit_cost := round(v_total_value / p_quantity, 4);
    END IF;

    INSERT INTO stock_movements (
      ingredient_id,
      product_id,
      movement_type,
      quantity,
      unit_cost,
      transaction_id,
      reference_type,
      reference_id,
      occurred_at,
      created_at
    )
    VALUES (
      NULL,
      p_product_id,
      'waste_out',
      p_quantity,
      v_unit_cost,
      NULL,
      'write_off',
      v_id,
      v_now,
      v_now
    );

    INSERT INTO write_offs (
      id,
      item_type,
      ingredient_id,
      product_id,
      quantity,
      unit_cost,
      total_value,
      reason,
      note,
      created_by,
      created_at
    )
    VALUES (
      v_id,
      'finished_good',
      NULL,
      p_product_id,
      p_quantity,
      v_unit_cost,
      v_total_value,
      p_reason,
      v_note,
      auth.uid(),
      v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'item_type', p_item_type,
    'total_value', v_total_value
  );
END;
$$;

COMMENT ON FUNCTION record_write_off(text, uuid, uuid, numeric, text, text) IS
  'Record a physical write-off. Ingredients: decrement_ingredient_stock + waste_out movement. Finished goods: allocate_finished_goods_fifo(waste, waste_ticket). Does not post journals.';

REVOKE ALL ON FUNCTION record_write_off(text, uuid, uuid, numeric, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_write_off(text, uuid, uuid, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION record_write_off(text, uuid, uuid, numeric, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Account 6150 + waste_expense binding
-- ---------------------------------------------------------------------------

INSERT INTO accounts (code, name, account_type)
SELECT '6150', 'Waste & Spoilage', 'expense'
WHERE NOT EXISTS (
  SELECT 1 FROM accounts a WHERE a.code = '6150'
);

INSERT INTO account_role_bindings (role, account_id, effective_from, effective_to, is_active)
SELECT
  'waste_expense',
  a.id,
  COALESCE(
    (
      SELECT fp.start_date
      FROM fiscal_periods fp
      WHERE fp.status = 'open'
      ORDER BY fp.start_date
      LIMIT 1
    ),
    '2020-01-01'::date
  ),
  NULL,
  true
FROM accounts a
WHERE a.code = '6150'
  AND NOT EXISTS (
    SELECT 1
    FROM account_role_bindings b
    WHERE b.role = 'waste_expense'
      AND b.is_active = true
  );

-- ---------------------------------------------------------------------------
-- 5. audit_log — sql/025 plus write_offs branch
-- CREATE OR REPLACE VIEW drops reloptions; restore security_invoker (sql/074).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW audit_log AS
SELECT
  ('purchase.created.' || p.id::text) AS event_id,
  p.created_at AS occurred_at,
  'purchase'::text AS entity_type,
  p.id AS entity_id,
  'created'::text AS action,
  NULL::uuid AS user_id,
  concat_ws(
    ' ',
    'Purchase created',
    NULLIF(p.invoice_number, ''),
    '(' || p.status || ')'
  ) AS summary,
  jsonb_build_object(
    'status', p.status,
    'invoice_number', p.invoice_number,
    'supplier_id', p.supplier_id,
    'total', p.total,
    'currency', p.currency,
    'purchased_at', p.purchased_at
  ) AS metadata
FROM purchases p

UNION ALL

SELECT
  ('purchase.received.' || p.id::text) AS event_id,
  COALESCE(p.updated_at, p.purchased_at, p.created_at) AS occurred_at,
  'purchase'::text AS entity_type,
  p.id AS entity_id,
  'received'::text AS action,
  NULL::uuid AS user_id,
  concat_ws(
    ' ',
    'Purchase received',
    NULLIF(p.invoice_number, '')
  ) AS summary,
  jsonb_build_object(
    'status', p.status,
    'invoice_number', p.invoice_number,
    'supplier_id', p.supplier_id,
    'total', p.total,
    'currency', p.currency,
    'purchased_at', p.purchased_at
  ) AS metadata
FROM purchases p
WHERE p.status = 'received'

UNION ALL

SELECT
  ('purchase.cancelled.' || p.id::text) AS event_id,
  COALESCE(p.updated_at, p.created_at) AS occurred_at,
  'purchase'::text AS entity_type,
  p.id AS entity_id,
  'cancelled'::text AS action,
  NULL::uuid AS user_id,
  concat_ws(
    ' ',
    'Purchase cancelled',
    NULLIF(p.invoice_number, '')
  ) AS summary,
  jsonb_build_object(
    'status', p.status,
    'invoice_number', p.invoice_number,
    'supplier_id', p.supplier_id
  ) AS metadata
FROM purchases p
WHERE p.status = 'cancelled'

UNION ALL

SELECT
  ('production_session.started.' || ps.id::text) AS event_id,
  COALESCE(ps.started_at, ps.created_at) AS occurred_at,
  'production_session'::text AS entity_type,
  ps.id AS entity_id,
  'started'::text AS action,
  NULL::uuid AS user_id,
  concat(
    'Production session #',
    ps.session_number::text,
    ' started'
  ) AS summary,
  jsonb_build_object(
    'status', ps.status,
    'session_number', ps.session_number,
    'production_plan_id', ps.production_plan_id,
    'operator_name', ps.operator_name
  ) AS metadata
FROM production_sessions ps

UNION ALL

SELECT
  ('production_session.completed.' || ps.id::text) AS event_id,
  ps.completed_at AS occurred_at,
  'production_session'::text AS entity_type,
  ps.id AS entity_id,
  'completed'::text AS action,
  ps.completed_by AS user_id,
  concat(
    'Production session #',
    ps.session_number::text,
    ' completed'
  ) AS summary,
  jsonb_build_object(
    'status', ps.status,
    'session_number', ps.session_number,
    'production_plan_id', ps.production_plan_id,
    'operator_name', ps.operator_name,
    'completed_by', ps.completed_by
  ) AS metadata
FROM production_sessions ps
WHERE ps.completed_at IS NOT NULL

UNION ALL

SELECT
  ('production_batch.produced.' || pb.id::text) AS event_id,
  pb.produced_at AS occurred_at,
  'production_batch'::text AS entity_type,
  pb.id AS entity_id,
  'produced'::text AS action,
  NULL::uuid AS user_id,
  concat(
    'Production batch #',
    pb.batch_number::text,
    ' produced'
  ) AS summary,
  jsonb_build_object(
    'batch_number', pb.batch_number,
    'production_session_id', pb.production_session_id,
    'finished_good_id', pb.finished_good_id,
    'recipe_id', pb.recipe_id,
    'produced_quantity', pb.produced_quantity,
    'unit_cost', pb.unit_cost
  ) AS metadata
FROM production_batches pb

UNION ALL

SELECT
  ('sale.created.' || s.id::text) AS event_id,
  s.created_at AS occurred_at,
  'sale'::text AS entity_type,
  s.id AS entity_id,
  'created'::text AS action,
  NULL::uuid AS user_id,
  concat('Sale ', s.sale_number, ' created') AS summary,
  jsonb_build_object(
    'sale_number', s.sale_number,
    'status', s.status,
    'customer_id', s.customer_id,
    'sale_date', s.sale_date,
    'total', s.total
  ) AS metadata
FROM sales s

UNION ALL

SELECT
  ('sale.confirmed.' || s.id::text) AS event_id,
  s.confirmed_at AS occurred_at,
  'sale'::text AS entity_type,
  s.id AS entity_id,
  'confirmed'::text AS action,
  NULL::uuid AS user_id,
  concat('Sale ', s.sale_number, ' confirmed') AS summary,
  jsonb_build_object(
    'sale_number', s.sale_number,
    'status', s.status,
    'customer_id', s.customer_id,
    'total', s.total,
    'confirmed_at', s.confirmed_at
  ) AS metadata
FROM sales s
WHERE s.confirmed_at IS NOT NULL

UNION ALL

SELECT
  ('sale.paid.' || s.id::text) AS event_id,
  s.paid_at AS occurred_at,
  'sale'::text AS entity_type,
  s.id AS entity_id,
  'paid'::text AS action,
  NULL::uuid AS user_id,
  concat('Sale ', s.sale_number, ' paid') AS summary,
  jsonb_build_object(
    'sale_number', s.sale_number,
    'status', s.status,
    'paid_at', s.paid_at
  ) AS metadata
FROM sales s
WHERE s.paid_at IS NOT NULL

UNION ALL

SELECT
  ('sale.cancelled.' || s.id::text) AS event_id,
  s.cancelled_at AS occurred_at,
  'sale'::text AS entity_type,
  s.id AS entity_id,
  'cancelled'::text AS action,
  NULL::uuid AS user_id,
  concat('Sale ', s.sale_number, ' cancelled') AS summary,
  jsonb_build_object(
    'sale_number', s.sale_number,
    'status', s.status,
    'cancelled_at', s.cancelled_at
  ) AS metadata
FROM sales s
WHERE s.cancelled_at IS NOT NULL

UNION ALL

SELECT
  ('sale_batch_consumption.recorded.' || c.id::text) AS event_id,
  c.created_at AS occurred_at,
  'sale'::text AS entity_type,
  c.source_id AS entity_id,
  'batch_consumed'::text AS action,
  c.created_by AS user_id,
  concat(
    'Sale batch consumption recorded (',
    c.direction,
    ', ',
    c.reason,
    ')'
  ) AS summary,
  jsonb_build_object(
    'consumption_id', c.id,
    'production_batch_id', c.production_batch_id,
    'quantity', c.quantity,
    'unit_cost', c.unit_cost,
    'total_cost', c.total_cost,
    'direction', c.direction,
    'reason', c.reason,
    'source_type', c.source_type,
    'source_id', c.source_id,
    'allocation_mode', c.allocation_mode
  ) AS metadata
FROM finished_goods_batch_consumptions c
WHERE c.source_type = 'sale_line'
  AND c.reason = 'sale'

UNION ALL

SELECT
  ('customer.created.' || c.id::text) AS event_id,
  c.created_at AS occurred_at,
  'customer'::text AS entity_type,
  c.id AS entity_id,
  'created'::text AS action,
  NULL::uuid AS user_id,
  concat('Customer ', c.code, ' created (', c.name, ')') AS summary,
  jsonb_build_object(
    'code', c.code,
    'name', c.name,
    'email', c.email,
    'is_active', c.is_active
  ) AS metadata
FROM customers c

UNION ALL

SELECT
  ('customer.updated.' || c.id::text) AS event_id,
  c.updated_at AS occurred_at,
  'customer'::text AS entity_type,
  c.id AS entity_id,
  'updated'::text AS action,
  NULL::uuid AS user_id,
  concat('Customer ', c.code, ' updated (', c.name, ')') AS summary,
  jsonb_build_object(
    'code', c.code,
    'name', c.name,
    'email', c.email,
    'is_active', c.is_active
  ) AS metadata
FROM customers c
WHERE c.updated_at IS DISTINCT FROM c.created_at
  AND c.is_active IS TRUE

UNION ALL

SELECT
  ('customer.deactivated.' || c.id::text) AS event_id,
  c.updated_at AS occurred_at,
  'customer'::text AS entity_type,
  c.id AS entity_id,
  'deactivated'::text AS action,
  NULL::uuid AS user_id,
  concat('Customer ', c.code, ' deactivated (', c.name, ')') AS summary,
  jsonb_build_object(
    'code', c.code,
    'name', c.name,
    'is_active', c.is_active
  ) AS metadata
FROM customers c
WHERE c.is_active IS NOT TRUE

UNION ALL

SELECT
  ('supplier.created.' || s.id::text) AS event_id,
  s.created_at AS occurred_at,
  'supplier'::text AS entity_type,
  s.id AS entity_id,
  'created'::text AS action,
  NULL::uuid AS user_id,
  concat('Supplier ', s.code, ' created (', s.name, ')') AS summary,
  jsonb_build_object(
    'code', s.code,
    'name', s.name,
    'email', s.email,
    'is_active', s.is_active
  ) AS metadata
FROM suppliers s

UNION ALL

SELECT
  ('supplier.updated.' || s.id::text) AS event_id,
  s.updated_at AS occurred_at,
  'supplier'::text AS entity_type,
  s.id AS entity_id,
  'updated'::text AS action,
  NULL::uuid AS user_id,
  concat('Supplier ', s.code, ' updated (', s.name, ')') AS summary,
  jsonb_build_object(
    'code', s.code,
    'name', s.name,
    'email', s.email,
    'is_active', s.is_active
  ) AS metadata
FROM suppliers s
WHERE s.updated_at IS DISTINCT FROM s.created_at
  AND s.is_active IS TRUE

UNION ALL

SELECT
  ('supplier.deactivated.' || s.id::text) AS event_id,
  s.updated_at AS occurred_at,
  'supplier'::text AS entity_type,
  s.id AS entity_id,
  'deactivated'::text AS action,
  NULL::uuid AS user_id,
  concat('Supplier ', s.code, ' deactivated (', s.name, ')') AS summary,
  jsonb_build_object(
    'code', s.code,
    'name', s.name,
    'is_active', s.is_active
  ) AS metadata
FROM suppliers s
WHERE s.is_active IS NOT TRUE

UNION ALL

SELECT
  ('write_off.recorded.' || w.id::text) AS event_id,
  w.created_at AS occurred_at,
  'write_off'::text AS entity_type,
  w.id AS entity_id,
  w.reason AS action,
  w.created_by AS user_id,
  concat_ws(
    ' ',
    'Write-off recorded',
    w.item_type,
    '(' || w.reason || ')'
  ) AS summary,
  jsonb_build_object(
    'item_type', w.item_type,
    'ingredient_id', w.ingredient_id,
    'product_id', w.product_id,
    'quantity', w.quantity,
    'total_value', w.total_value,
    'reason', w.reason
  ) AS metadata
FROM write_offs w;

COMMENT ON VIEW audit_log IS
  'Read-only audit/event projection over purchases, production, sales, customers, suppliers, and write-offs. Stable event_id strings; no triggers or mutations.';

GRANT SELECT ON audit_log TO authenticated;
ALTER VIEW audit_log SET (security_invoker = true);
