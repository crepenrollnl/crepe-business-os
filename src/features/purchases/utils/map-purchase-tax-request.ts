/**
 * Map Purchase tax document → generic Tax Integration TaxRequest (DEV-099).
 *
 * Reusable mapper — no Country Pack / Tax Engine knowledge.
 */

import type { TaxRequest } from "@/features/tax-integration";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { PurchaseTaxDocument } from "../types/purchase-tax";

export function mapPurchaseDocumentToTaxRequest(
  document: PurchaseTaxDocument,
  requestId: string,
): ServiceResult<TaxRequest> {
  if (!document.supplier.country_code?.trim()) {
    return fail("Supplier country is required for tax calculation.");
  }

  if (!document.country?.trim()) {
    return fail("Company/tax country is required for tax calculation.");
  }

  if (!Array.isArray(document.lines) || document.lines.length === 0) {
    return fail("Purchase document must include at least one line.");
  }

  for (const line of document.lines) {
    if (!line.tax_category?.trim()) {
      return fail("Tax category is required on every purchase line.");
    }
  }

  return ok({
    request_id: requestId,
    company: {
      company_id: document.company.company_id,
      legal_name: document.company.legal_name ?? null,
      base_currency: document.company.base_currency ?? document.currency,
    },
    country: document.country.trim().toUpperCase(),
    jurisdiction: document.jurisdiction ?? null,
    document_type: "purchase",
    transaction_date: document.transaction_date,
    currency: document.currency,
    supplier: {
      party_type: "supplier",
      party_id: document.supplier.supplier_id,
      country_code: document.supplier.country_code.trim().toUpperCase(),
      attributes: document.supplier.name
        ? { supplier_name: document.supplier.name }
        : undefined,
    },
    lines: document.lines.map((line) => ({
      line_id: line.line_id,
      quantity: line.quantity,
      unit_price: line.unit_price,
      discount: line.discount ?? 0,
      tax_category: line.tax_category.trim(),
      tax_regime: line.tax_regime?.trim() || null,
      tax_code: line.tax_code?.trim() || null,
      price_mode: "exclusive" as const,
    })),
  });
}
