/**
 * Build a PurchaseTaxDocument from purchase form values (DEV-099).
 *
 * `unit_price` is the amount currently in the form (typed). `price_mode`
 * tells calculate_purchase_taxes whether that amount is exclusive or
 * inclusive. Lines that are not yet complete (missing/zero quantity,
 * missing unit price, or missing tax category) are left out of the
 * document entirely — calculate_purchase_taxes rejects the WHOLE request
 * if any line it receives is incomplete, so an in-progress blank row
 * (e.g. a freshly added "+Add line" row) must never be sent, or the RPC
 * blanks every row's preview, not just the incomplete one.
 *
 * `line_id` still encodes the line's ORIGINAL position in
 * `values.lines` (`line-${index + 1}`) even after filtering, because the
 * caller (purchase-document-modal.tsx) matches preview rows back to form
 * rows positionally by that same original index — renumbering after the
 * filter would silently attach the wrong tax result to the wrong row.
 */

import type { PurchaseFormValues, PurchaseSupplier } from "../types/purchase";
import type {
  PurchaseTaxDocument,
  PurchaseTaxLineInput,
} from "../types/purchase-tax";

const DEFAULT_TAX_COUNTRY = "NL";
const DEFAULT_CURRENCY = "EUR";
const DEFAULT_COMPANY_ID = "company-local";

function isCompleteTaxLine(
  line: PurchaseFormValues["lines"][number],
): boolean {
  return (
    Number.isFinite(line.quantity) &&
    line.quantity > 0 &&
    Number.isFinite(line.unit_cost) &&
    line.unit_cost >= 0 &&
    Boolean(line.tax_category?.trim())
  );
}

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

  const lines = input.values.lines.reduce<PurchaseTaxLineInput[]>(
    (acc, line, index) => {
      if (!isCompleteTaxLine(line)) {
        return acc;
      }
      acc.push({
        line_id: `line-${index + 1}`,
        quantity: line.quantity,
        unit_price: line.unit_cost,
        discount: line.discount ?? 0,
        price_mode:
          line.price_mode === "inclusive" ? "inclusive" : "exclusive",
        tax_category: line.tax_category?.trim() ?? "",
        tax_regime: line.tax_regime?.trim() || null,
      });
      return acc;
    },
    [],
  );

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
    lines,
  };
}
