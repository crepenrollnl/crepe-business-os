/**
 * Purchase Tax Service (DEV-099).
 *
 * Purchases → Tax Integration Service only.
 * Never accesses Tax Engine, Country Packs, rates, or rules.
 */

import { roundMoney } from "@/lib/money";
import { taxIntegrationService } from "@/features/tax-integration";
import type { TaxResult } from "@/features/tax-integration";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  PurchaseTaxDocument,
  PurchaseTaxLineView,
  PurchaseTaxResult,
} from "../types/purchase-tax";
import { mapPurchaseDocumentToTaxRequest } from "../utils/map-purchase-tax-request";

function toLineViews(taxResult: TaxResult): PurchaseTaxLineView[] {
  return taxResult.lines.map((line) => {
    const primary = line.taxes[0] ?? null;
    const taxRatePercent =
      primary !== null ? roundMoney(primary.rate_value * 100) : null;

    return {
      line_id: line.line_id,
      tax_code: primary?.tax_code ?? null,
      tax_rate_percent: taxRatePercent,
      tax_amount: line.tax_amount,
      taxable_amount: line.taxable_amount,
      net_amount: line.net_amount,
      gross_amount: line.gross_amount,
    };
  });
}

function toPurchaseTaxResult(
  document: PurchaseTaxDocument,
  taxResult: TaxResult,
): PurchaseTaxResult {
  const subtotal = roundMoney(
    taxResult.lines.reduce((sum, line) => sum + line.taxable_amount, 0),
  );

  return {
    document_id: document.document_id ?? null,
    mode: taxResult.mode,
    is_valid: taxResult.is_valid,
    subtotal,
    tax_total: taxResult.tax_total,
    grand_total: taxResult.gross_total,
    effective_tax_rate: taxResult.effective_tax_rate,
    lines: toLineViews(taxResult),
    warnings: taxResult.warnings,
    tax_result: taxResult,
  };
}

function run(
  document: PurchaseTaxDocument,
  mode: "calculate" | "preview" | "validate",
): ServiceResult<PurchaseTaxResult> {
  const requestId =
    document.document_id?.trim() ||
    `purchase-tax-${document.transaction_date}-${document.lines.length}`;

  const mapped = mapPurchaseDocumentToTaxRequest(document, requestId);
  if (mapped.error || !mapped.data) {
    return fail(mapped.error ?? "Failed to map purchase tax request.");
  }

  const integration =
    mode === "calculate"
      ? taxIntegrationService.calculateTaxes(mapped.data)
      : mode === "preview"
        ? taxIntegrationService.previewTaxes(mapped.data)
        : taxIntegrationService.validateTaxes(mapped.data);

  if (integration.error || !integration.data) {
    return fail(integration.error ?? "Tax calculation failed.");
  }

  return ok(toPurchaseTaxResult(document, integration.data));
}

export const purchaseTaxService = {
  calculatePurchaseTaxes(
    document: PurchaseTaxDocument,
  ): ServiceResult<PurchaseTaxResult> {
    return run(document, "calculate");
  },

  previewPurchaseTaxes(
    document: PurchaseTaxDocument,
  ): ServiceResult<PurchaseTaxResult> {
    return run(document, "preview");
  },

  validatePurchaseTaxes(
    document: PurchaseTaxDocument,
  ): ServiceResult<PurchaseTaxResult> {
    return run(document, "validate");
  },
};
