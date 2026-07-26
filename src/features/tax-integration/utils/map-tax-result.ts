/**
 * Map Tax Engine result → integration TaxResult (DEV-098).
 */

import { roundMoney } from "@/lib/money";
import type {
  TaxCalculationContext,
  TaxResult as EngineTaxResult,
} from "@/types/tax-engine";
import type {
  TaxAppliedDefinition,
  TaxIntegrationMode,
  TaxLineResult,
  TaxRequest,
  TaxResult,
  TaxValidationWarning,
} from "../types/tax-integration";
import { computeLineTaxableAmount } from "./map-tax-request";

export function mapEngineResultToIntegrationResult(input: {
  request: TaxRequest;
  engineResult: EngineTaxResult;
  context: TaxCalculationContext;
  mode: TaxIntegrationMode;
  isValid?: boolean;
}): TaxResult {
  const { request, engineResult, context, mode } = input;
  const warnings: TaxValidationWarning[] = [];

  const lines: TaxLineResult[] = request.lines.map((line) => {
    const taxes = engineResult.breakdown.lines.filter(
      (row) => row.line_id === line.line_id,
    );
    const taxAmount = roundMoney(
      taxes.reduce((sum, row) => sum + row.tax_amount, 0),
    );
    const taxableAmount = computeLineTaxableAmount(line);
    const netAmount =
      taxes.length > 0 ? roundMoney(taxes[0]!.net_amount) : taxableAmount;

    const resolvedGross =
      (line.price_mode ?? "exclusive") === "inclusive"
        ? taxableAmount
        : roundMoney(netAmount + taxAmount);

    if (taxes.length === 0) {
      warnings.push({
        code: "NO_TAX_APPLIED",
        message: "No tax was applied to the line item.",
        details: { line_id: line.line_id },
      });
    } else if (taxes.length > 1) {
      warnings.push({
        code: "MULTIPLE_TAXES_ON_LINE",
        message: "Multiple taxes were applied to the line item.",
        details: { line_id: line.line_id, tax_count: taxes.length },
      });
    }

    if (taxes.length > 0 && taxAmount === 0) {
      warnings.push({
        code: "ZERO_TAX_AMOUNT",
        message: "Applied tax amount is zero for the line item.",
        details: { line_id: line.line_id },
      });
    }

    return {
      line_id: line.line_id,
      taxable_amount: taxableAmount,
      tax_amount: taxAmount,
      net_amount: netAmount,
      gross_amount: resolvedGross,
      taxes,
    };
  });

  const appliedMap = new Map<string, TaxAppliedDefinition>();
  for (const row of engineResult.breakdown.lines) {
    if (appliedMap.has(row.tax_definition_id)) {
      continue;
    }
    const definition = context.definitions.find(
      (item) => item.id === row.tax_definition_id,
    );
    appliedMap.set(row.tax_definition_id, {
      tax_definition_id: row.tax_definition_id,
      tax_code: row.tax_code,
      name: definition?.name ?? row.tax_code,
      rate_value: row.rate_value,
    });
  }

  const effectiveTaxRate =
    engineResult.net_total > 0
      ? roundMoney(engineResult.tax_total / engineResult.net_total)
      : 0;

  return {
    request_id: request.request_id,
    mode,
    country: request.country.trim().toUpperCase(),
    currency: engineResult.currency,
    jurisdiction_id: engineResult.jurisdiction_id,
    document_type: String(request.document_type),
    transaction_date: request.transaction_date,
    net_total: engineResult.net_total,
    tax_total: engineResult.tax_total,
    gross_total: engineResult.gross_total,
    effective_tax_rate: effectiveTaxRate,
    breakdown: engineResult.breakdown,
    lines,
    applied_tax_definitions: [...appliedMap.values()],
    rounding: {
      mode: context.rounding.mode,
      decimal_places: context.rounding.decimal_places,
    },
    warnings,
    is_valid: input.isValid ?? true,
  };
}
