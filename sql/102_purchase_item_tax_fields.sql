-- Purchase line tax memory (variant C)
-- Run in Supabase SQL editor after sql/001_create_purchases.sql
-- (and after sql/072_calculate_purchase_taxes.sql is in place).
--
-- Problem: the purchase form always treated Unit price as exclusive, and
-- purchase_items stored only quantity / unit_cost / line_total. Tax category,
-- tax regime, and whether the typed price included VAT were lost, so reopening
-- a Received purchase silently defaulted to goods / standard_vat.
--
-- Variant C:
--   unit_cost / line_total stay exclusive net (sql/069 unchanged).
--   entered_unit_price remembers the number the user typed (may be gross).
--   price_mode remembers exclusive vs inclusive for display on reopen.
--   tax_category / tax_regime remember the line's tax identity.
--
-- Existing rows stay NULL — UI must show "Not recorded" / "—", never
-- substitute goods / standard_vat.
--
-- Additive only. Does NOT:
--   - change calculate_purchase_totals (sql/069)
--   - change calculate_purchase_taxes (sql/072) — inclusive already works
--   - rewrite purchase_price_history / supplier insights (they read unit_cost)

ALTER TABLE purchase_items
  ADD COLUMN IF NOT EXISTS tax_category text,
  ADD COLUMN IF NOT EXISTS tax_regime text,
  ADD COLUMN IF NOT EXISTS price_mode text,
  ADD COLUMN IF NOT EXISTS entered_unit_price numeric(12, 4);

ALTER TABLE purchase_items
  DROP CONSTRAINT IF EXISTS purchase_items_price_mode_check;

ALTER TABLE purchase_items
  ADD CONSTRAINT purchase_items_price_mode_check
  CHECK (price_mode IS NULL OR price_mode IN ('exclusive', 'inclusive'));

ALTER TABLE purchase_items
  DROP CONSTRAINT IF EXISTS purchase_items_entered_unit_price_check;

ALTER TABLE purchase_items
  ADD CONSTRAINT purchase_items_entered_unit_price_check
  CHECK (entered_unit_price IS NULL OR entered_unit_price >= 0);

COMMENT ON COLUMN purchase_items.tax_category IS
  'Opaque tax category used when this line was calculated. NULL on rows saved before sql/102.';

COMMENT ON COLUMN purchase_items.tax_regime IS
  'Opaque tax regime hint used when this line was calculated. NULL on rows saved before sql/102.';

COMMENT ON COLUMN purchase_items.price_mode IS
  'Whether entered_unit_price was typed exclusive or inclusive of tax. NULL on rows saved before sql/102. unit_cost is always exclusive net.';

COMMENT ON COLUMN purchase_items.entered_unit_price IS
  'Unit amount as typed on the purchase form (may be gross). Display-only memory for receipt matching. unit_cost remains the exclusive net source of truth.';
