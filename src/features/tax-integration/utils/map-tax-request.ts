/**
 * Map integration TaxRequest → Tax Engine request lines (DEV-098).
 */

import { roundMoney } from "@/lib/money";
import type {
  TaxLineRequest as EngineTaxLineRequest,
  TaxRequest as EngineTaxRequest,
  TaxCalculationContext,
} from "@/types/tax-engine";
import type { TaxIntegrationLineItem, TaxRequest } from "../types/tax-integration";

export function computeLineTaxableAmount(line: TaxIntegrationLineItem): number {
  const discount = line.discount ?? 0;
  return roundMoney(line.quantity * line.unit_price - discount);
}

export function mapIntegrationLineToEngineLine(
  line: TaxIntegrationLineItem,
  documentCurrency: string,
): EngineTaxLineRequest {
  const taxCodes: string[] = [];
  if (line.tax_codes) {
    taxCodes.push(...line.tax_codes);
  }
  if (line.tax_code) {
    taxCodes.push(line.tax_code);
  }

  const attributes: Record<string, string> = {
    category: line.tax_category.trim(),
    ...(line.attributes ?? {}),
  };

  if (line.tax_regime && line.tax_regime.trim().length > 0) {
    attributes.regime = line.tax_regime.trim();
  }

  const uniqueCodes = [...new Set(taxCodes.map((code) => code.trim()).filter(Boolean))];

  return {
    line_id: line.line_id,
    amount: computeLineTaxableAmount(line),
    quantity: line.quantity,
    currency: documentCurrency,
    price_mode: line.price_mode ?? "exclusive",
    ...(uniqueCodes.length > 0 ? { tax_codes: uniqueCodes } : {}),
    attributes,
  };
}

export function mapToEngineTaxRequest(
  request: TaxRequest,
  context: TaxCalculationContext,
): EngineTaxRequest {
  return {
    request_id: request.request_id,
    context: {
      ...context,
      occurred_at: request.transaction_date,
      currency: request.currency,
      jurisdiction_id:
        request.jurisdiction?.trim() || context.jurisdiction_id,
    },
    lines: request.lines.map((line) =>
      mapIntegrationLineToEngineLine(line, request.currency),
    ),
  };
}
