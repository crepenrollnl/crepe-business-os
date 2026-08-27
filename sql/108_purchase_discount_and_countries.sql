-- sql/108_purchase_discount_and_countries.sql
-- После sql/102. Аддитивно. Старые строки: NULL, не 0 и не 'NL'.
-- Не меняет calculate_purchase_totals / calculate_purchase_taxes / receive_*.
-- Нет CREATE FUNCTION → нет REVOKE/GRANT.

ALTER TABLE purchase_items
  ADD COLUMN IF NOT EXISTS discount numeric(12, 2);

ALTER TABLE purchase_items
  DROP CONSTRAINT IF EXISTS purchase_items_discount_check;

ALTER TABLE purchase_items
  ADD CONSTRAINT purchase_items_discount_check
  CHECK (discount IS NULL OR discount >= 0);

COMMENT ON COLUMN purchase_items.discount IS
  'Absolute line discount in document currency, same units as sql/069/sql/072. NULL on rows saved before sql/108. Not a percent. unit_cost stays exclusive net before this discount.';

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS tax_country text,
  ADD COLUMN IF NOT EXISTS supplier_country text;

ALTER TABLE purchases
  DROP CONSTRAINT IF EXISTS purchases_tax_country_check;
ALTER TABLE purchases
  ADD CONSTRAINT purchases_tax_country_check
  CHECK (tax_country IS NULL OR tax_country ~ '^[A-Z]{2}$');

ALTER TABLE purchases
  DROP CONSTRAINT IF EXISTS purchases_supplier_country_check;
ALTER TABLE purchases
  ADD CONSTRAINT purchases_supplier_country_check
  CHECK (supplier_country IS NULL OR supplier_country ~ '^[A-Z]{2}$');

COMMENT ON COLUMN purchases.tax_country IS
  'ISO 3166-1 alpha-2 for calculate_purchase_taxes p_country. NULL before sql/108. UI must not substitute NL on reopen.';

COMMENT ON COLUMN purchases.supplier_country IS
  'ISO 3166-1 alpha-2 as typed on the purchase header. Not stored on suppliers. NULL before sql/108. Not used by sql/072 rate lookup today.';
