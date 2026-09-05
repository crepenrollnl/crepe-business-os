/**
 * Derive exclusive net unit_cost from a typed gross Line total via an
 * isolated calculate_purchase_taxes probe (price_mode=inclusive).
 * Purchases never inverts VAT in JS and never reads Country Pack rates.
 */

import { fail, ok, type ServiceResult } from "@/types/service";
import { purchaseTaxService } from "../services/purchase-tax-service";
import type {
  PurchaseTaxDocument,
  PurchaseTaxResult,
} from "../types/purchase-tax";

export const LINE_TOTAL_PROBE_LINE_ID = "line-total-probe";

export const LINE_TOTAL_UNIT_PRICE_ERROR =
  "Could not calculate unit price from this line total. Check the tax category.";

const DEFAULT_TAX_COUNTRY = "NL";
const DEFAULT_CURRENCY = "EUR";
const DEFAULT_COMPANY_ID = "company-local";

function roundUnitCost(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export interface ExclusiveLineTotalProbeInput {
  purchasedAt: string;
  taxCountry: string;
  supplierCountry: string;
  supplierId: string;
  supplierName: string | null;
  documentId?: string | null;
  quantity: number;
  lineTotal: number;
  taxCategory: string;
  taxRegime: string;
  discount?: number;
}

export function buildExclusiveLineTotalProbeDocument(
  input: ExclusiveLineTotalProbeInput,
): PurchaseTaxDocument {
  const taxCountry = input.taxCountry.trim() || DEFAULT_TAX_COUNTRY;
  const supplierCountry = input.supplierCountry.trim() || taxCountry;

  return {
    document_id: input.documentId ?? null,
    company: {
      company_id: DEFAULT_COMPANY_ID,
      base_currency: DEFAULT_CURRENCY,
    },
    country: taxCountry,
    transaction_date: input.purchasedAt,
    currency: DEFAULT_CURRENCY,
    supplier: {
      supplier_id: input.supplierId || null,
      name: input.supplierName,
      country_code: supplierCountry || null,
    },
    lines: [
      {
        line_id: LINE_TOTAL_PROBE_LINE_ID,
        quantity: input.quantity,
        unit_price: input.lineTotal / input.quantity,
        discount: input.discount ?? 0,
        price_mode: "inclusive",
        tax_category: input.taxCategory.trim(),
        tax_regime: input.taxRegime.trim() || null,
      },
    ],
  };
}

export function interpretExclusiveLineTotalProbe(
  result: ServiceResult<PurchaseTaxResult>,
  quantity: number,
): ServiceResult<{ unitCost: number; netAmount: number }> {
  if (result.error || !result.data) {
    return fail(result.error ?? LINE_TOTAL_UNIT_PRICE_ERROR);
  }

  const taxLine = result.data.lines.find(
    (line) => line.line_id === LINE_TOTAL_PROBE_LINE_ID,
  );

  if (
    !taxLine ||
    taxLine.tax_rate_percent === null ||
    !Number.isFinite(taxLine.net_amount)
  ) {
    return fail(LINE_TOTAL_UNIT_PRICE_ERROR);
  }

  return ok({
    unitCost: roundUnitCost(taxLine.net_amount / quantity),
    netAmount: taxLine.net_amount,
  });
}

export async function deriveExclusiveUnitCostFromLineTotal(
  input: ExclusiveLineTotalProbeInput,
): Promise<ServiceResult<{ unitCost: number; netAmount: number }>> {
  if (!input.taxCategory.trim() || !input.purchasedAt.trim()) {
    return fail(LINE_TOTAL_UNIT_PRICE_ERROR);
  }

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return fail(LINE_TOTAL_UNIT_PRICE_ERROR);
  }

  const document = buildExclusiveLineTotalProbeDocument(input);
  const result = await purchaseTaxService.previewPurchaseTaxes(document);
  return interpretExclusiveLineTotalProbe(result, input.quantity);
}
