/**
 * Build a PurchaseTaxDocument from purchase form values (DEV-099).
 *
 * `unit_price` is the amount currently in the form (typed). `price_mode`
 * tells calculate_purchase_taxes whether that amount is exclusive or
 * inclusive. Does not substitute goods / standard_vat for blank lines —
 * missing category is rejected by purchase-tax-service.
 */

import type { PurchaseFormValues, PurchaseSupplier } from "../types/purchase";
import type { PurchaseTaxDocument } from "../types/purchase-tax";

const DEFAULT_TAX_COUNTRY = "NL";
const DEFAULT_CURRENCY = "EUR";
const DEFAULT_COMPANY_ID = "company-local";

export function buildPurchaseTaxDocument(input: {
  values: PurchaseFormValues;
  suppliers: readonly PurchaseSupplier[];
  documentId?: string | null;
  companyId?: string;
  currency?: string;
}): PurchaseTaxDocument {
  const supplier = input.suppliers.find(
    (row) => row.id === input.values.supplier_id,
  );
  const taxCountry =
    input.values.tax_country?.trim() || DEFAULT_TAX_COUNTRY;
  const supplierCountry =
    input.values.supplier_country?.trim() || taxCountry;

  return {
    document_id: input.documentId ?? null,
    company: {
      company_id: input.companyId ?? DEFAULT_COMPANY_ID,
      base_currency: input.currency ?? DEFAULT_CURRENCY,
    },
    country: taxCountry,
    transaction_date: input.values.purchased_at,
    currency: input.currency ?? DEFAULT_CURRENCY,
    supplier: {
      supplier_id: input.values.supplier_id || null,
      name: supplier?.name ?? null,
      country_code: supplierCountry || null,
    },
    lines: input.values.lines.map((line, index) => ({
      line_id: `line-${index + 1}`,
      quantity: line.quantity,
      unit_price: line.unit_cost,
      discount: line.discount ?? 0,
      price_mode: line.price_mode === "inclusive" ? "inclusive" : "exclusive",
      tax_category: line.tax_category?.trim() ?? "",
      tax_regime: line.tax_regime?.trim() || null,
    })),
  };
}
