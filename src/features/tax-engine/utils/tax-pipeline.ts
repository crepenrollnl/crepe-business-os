/**
 * Tax Calculation Pipeline (DEV-096).
 *
 * Tax Request
 *   → Tax Rule Resolution
 *   → Rate Resolution
 *   → Calculation
 *   → Rounding
 *   → Validation
 *   → Tax Result
 *
 * Supports multiple taxes per line / request.
 * No Localization Pack / country / regime logic.
 */

import type {
  TaxBreakdownLine,
  TaxCalculator,
  TaxCode,
  TaxDefinition,
  TaxPipelineResult,
  TaxRequest,
  TaxResult,
  TaxType,
} from "@/types/tax-engine";
import { defaultTaxCalculator } from "./tax-calculation";
import { taxError } from "./tax-errors";
import { resolveTaxRate } from "./tax-rate-resolution";
import { resolveTaxRulesForLine } from "./tax-rule-resolution";
import {
  validateTaxContext,
  validateTaxRequest,
  validateTaxResult,
} from "./tax-validation";

function indexById<T extends { id: string }>(
  rows: readonly T[],
): Record<string, T> {
  const map: Record<string, T> = {};
  for (const row of rows) {
    map[row.id] = row;
  }
  return map;
}

function sumRounded(
  values: readonly number[],
  round: (value: number) => number,
): number {
  return round(values.reduce((sum, value) => sum + value, 0));
}

/**
 * Execute the generic tax calculation pipeline.
 */
export function runTaxPipeline(
  request: TaxRequest,
  calculator: TaxCalculator = defaultTaxCalculator,
): TaxPipelineResult {
  const requestError = validateTaxRequest(request);
  if (requestError) {
    return { ok: false, error: requestError };
  }

  const contextError = validateTaxContext(request.context);
  if (contextError) {
    return { ok: false, error: contextError };
  }

  const { context } = request;
  const definitionsById = indexById(context.definitions);
  const typesById = indexById(context.types);
  const round = (value: number) => context.rounding.round(value);

  const breakdownLines: TaxBreakdownLine[] = [];
  const netByLine = new Map<string, number>();
  const grossByLine = new Map<string, number>();

  for (const line of request.lines) {
    const resolved = resolveTaxRulesForLine({
      line,
      rules: context.rules,
      definitionsById,
      jurisdictionId: context.jurisdiction_id,
      occurredAt: context.occurred_at,
    });

    if (!resolved.ok) {
      return { ok: false, error: resolved.error };
    }

    if (resolved.applications.length === 0) {
      // No taxes — pass through exclusive amount as net/gross.
      netByLine.set(line.line_id, round(line.amount));
      grossByLine.set(line.line_id, round(line.amount));
      continue;
    }

    let lineNet = 0;
    let lineTax = 0;
    let sawInclusive = false;

    for (const application of resolved.applications) {
      const definition: TaxDefinition = application.definition;
      const taxType: TaxType | undefined = typesById[definition.type_id];

      if (!taxType || !taxType.is_active) {
        return {
          ok: false,
          error: taxError(
            "TYPE_NOT_FOUND",
            "Tax definition references a missing or inactive tax type.",
            {
              tax_definition_id: definition.id,
              type_id: definition.type_id,
            },
          ),
        };
      }

      const rateResult = resolveTaxRate({
        taxDefinitionId: definition.id,
        rates: context.rates,
        occurredAt: context.occurred_at,
      });
      if (!rateResult.ok) {
        return { ok: false, error: rateResult.error };
      }

      const calculated = calculator.calculate({
        method: taxType.application_method,
        rateValue: rateResult.rate.rate_value,
        amount: line.amount,
        quantity: line.quantity,
        priceMode: line.price_mode,
      });

      const taxableBase = round(calculated.taxableBase);
      const taxAmount = round(calculated.taxAmount);
      const netAmount = round(calculated.netAmount);
      const grossAmount = round(calculated.grossAmount);

      breakdownLines.push({
        line_id: line.line_id,
        tax_code: definition.tax_code,
        tax_definition_id: definition.id,
        tax_rule_id: application.rule.id,
        tax_rate_id: rateResult.rate.id,
        jurisdiction_id: definition.jurisdiction_id,
        direction: definition.direction,
        application_method: taxType.application_method,
        taxable_base: taxableBase,
        rate_value: rateResult.rate.rate_value,
        tax_amount: taxAmount,
        net_amount: netAmount,
        gross_amount: grossAmount,
      });

      if (line.price_mode === "inclusive") {
        sawInclusive = true;
        lineNet = netAmount;
        lineTax += taxAmount;
      } else {
        lineNet = netAmount;
        lineTax += taxAmount;
      }
    }

    netByLine.set(line.line_id, round(lineNet));
    if (sawInclusive) {
      grossByLine.set(line.line_id, round(line.amount));
    } else {
      grossByLine.set(line.line_id, round(lineNet + lineTax));
    }
  }

  const byTaxCode: Record<TaxCode, number> = {};
  for (const row of breakdownLines) {
    byTaxCode[row.tax_code] = round(
      (byTaxCode[row.tax_code] ?? 0) + row.tax_amount,
    );
  }

  const result: TaxResult = {
    request_id: request.request_id,
    currency: context.currency,
    jurisdiction_id: context.jurisdiction_id,
    net_total: sumRounded([...netByLine.values()], round),
    tax_total: sumRounded(
      breakdownLines.map((row) => row.tax_amount),
      round,
    ),
    gross_total: sumRounded([...grossByLine.values()], round),
    breakdown: {
      lines: breakdownLines,
      by_tax_code: byTaxCode,
    },
  };

  const validationError = validateTaxResult(result);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  return { ok: true, data: result };
}
