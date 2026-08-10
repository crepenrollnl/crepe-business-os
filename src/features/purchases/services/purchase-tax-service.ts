/**
 * Purchase Tax Service (DEV-099, V1 plan 1.6).
 *
 * Purchases → calculate_purchase_taxes RPC only.
 * Never accesses tax_jurisdictions/tax_definitions/tax_rates/tax_rules
 * directly, and no longer depends on the in-browser Tax Engine / Tax
 * Integration / Country Pack pipeline (src/features/tax-engine,
 * tax-integration, tax-packs — kept unused, not deleted).
 */

import { roundMoney } from "@/lib/money";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  PurchaseTaxDocument,
  PurchaseTaxLineView,
  PurchaseTaxResult,
} from "../types/purchase-tax";

interface CalculatePurchaseTaxesRpcTaxLine {
  tax_code: string;
  direction: "input" | "output" | "neutral";
  application_method: string;
  taxable_base: number;
  rate_value: number;
  tax_amount: number;
  net_amount: number;
  gross_amount: number;
}

interface CalculatePurchaseTaxesRpcLine {
  line_id: string;
  taxable_amount: number;
  tax_amount: number;
  net_amount: number;
  gross_amount: number;
  taxes: CalculatePurchaseTaxesRpcTaxLine[];
}

interface CalculatePurchaseTaxesRpcResult {
  currency: string;
  subtotal: number;
  tax_total: number;
  grand_total: number;
  effective_tax_rate: number;
  lines: CalculatePurchaseTaxesRpcLine[];
  is_valid: boolean;
}

function validateDocument(document: PurchaseTaxDocument): string | null {
  if (!document.supplier.country_code?.trim()) {
    return "Supplier country is required for tax calculation.";
  }

  if (!document.country?.trim()) {
    return "Company/tax country is required for tax calculation.";
  }

  if (!Array.isArray(document.lines) || document.lines.length === 0) {
    return "Purchase document must include at least one line.";
  }

  for (const line of document.lines) {
    if (!line.tax_category?.trim()) {
      return "Tax category is required on every purchase line.";
    }
  }

  return null;
}

function toLineViews(
  lines: CalculatePurchaseTaxesRpcLine[],
): PurchaseTaxLineView[] {
  return lines.map((line) => {
    const primary = line.taxes[0] ?? null;

    return {
      line_id: line.line_id,
      tax_code: primary?.tax_code ?? null,
      tax_rate_percent:
        primary !== null ? roundMoney(primary.rate_value * 100) : null,
      tax_amount: line.tax_amount,
      taxable_amount: line.taxable_amount,
      net_amount: line.net_amount,
      gross_amount: line.gross_amount,
    };
  });
}

function toPurchaseTaxResult(
  document: PurchaseTaxDocument,
  mode: "calculate" | "preview" | "validate",
  rpcResult: CalculatePurchaseTaxesRpcResult,
): PurchaseTaxResult {
  const linesById = new Map(
    document.lines.map((line) => [line.line_id, line]),
  );

  const warnings = rpcResult.lines
    .filter((line) => line.taxes.length === 0)
    .map((line) => linesById.get(line.line_id))
    .filter((line): line is PurchaseTaxDocument["lines"][number] => Boolean(line))
    .map(
      (line) =>
        `No tax rule found for category '${line.tax_category}' with regime '${line.tax_regime ?? "standard_vat"}'. Tax amount set to 0. Please check the tax regime selection.`,
    );

  return {
    document_id: document.document_id ?? null,
    mode,
    is_valid: rpcResult.is_valid,
    subtotal: rpcResult.subtotal,
    tax_total: rpcResult.tax_total,
    grand_total: rpcResult.grand_total,
    effective_tax_rate: rpcResult.effective_tax_rate,
    lines: toLineViews(rpcResult.lines),
    warnings,
    tax_result: {
      currency: rpcResult.currency,
      breakdown: {
        lines: rpcResult.lines.flatMap((line) => line.taxes),
      },
    },
  };
}

async function run(
  document: PurchaseTaxDocument,
  mode: "calculate" | "preview" | "validate",
): Promise<ServiceResult<PurchaseTaxResult>> {
  try {
    const validationError = validateDocument(document);
    if (validationError) {
      return fail(validationError);
    }

    const { data, error } = await supabase.rpc("calculate_purchase_taxes", {
      p_country: document.country.trim().toUpperCase(),
      p_transaction_date: document.transaction_date.slice(0, 10),
      p_currency: document.currency,
      p_lines: document.lines.map((line) => ({
        line_id: line.line_id,
        quantity: line.quantity,
        unit_price: line.unit_price,
        discount: line.discount ?? 0,
        price_mode: "exclusive",
        tax_category: line.tax_category.trim(),
        tax_regime: line.tax_regime?.trim() || null,
        tax_codes: line.tax_code?.trim() ? [line.tax_code.trim()] : undefined,
      })),
    });

    if (error || !data) {
      return fail(toUserError(error, "Tax calculation failed."));
    }

    return ok(
      toPurchaseTaxResult(
        document,
        mode,
        data as CalculatePurchaseTaxesRpcResult,
      ),
    );
  } catch (error) {
    return fail(toUserError(error, "Tax calculation failed."));
  }
}

export const purchaseTaxService = {
  calculatePurchaseTaxes(
    document: PurchaseTaxDocument,
  ): Promise<ServiceResult<PurchaseTaxResult>> {
    return run(document, "calculate");
  },

  previewPurchaseTaxes(
    document: PurchaseTaxDocument,
  ): Promise<ServiceResult<PurchaseTaxResult>> {
    return run(document, "preview");
  },

  validatePurchaseTaxes(
    document: PurchaseTaxDocument,
  ): Promise<ServiceResult<PurchaseTaxResult>> {
    return run(document, "validate");
  },
};
