/**
 * Sales Profit service (DEV-110).
 *
 * Builds frozen sale profit from stored net revenue (sale.subtotal) and
 * frozen COGS (DEV-108). Never recalculates VAT or COGS.
 *
 * Explicit buildFrozenSaleProfit registers once per process for duplicate
 * protection after sale completion. UI reloads use getSaleProfitSummary
 * (idempotent re-derivation from the same frozen facts).
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { SaleProfitSummary } from "../types/sale-profit";
import type { SaleStatus } from "../types/sale";
import {
  assertSaleProfitImmutable,
  buildSaleProfitSummary,
} from "../utils/sale-profit-builder";
import { saleCogsService } from "./sale-cogs-service";
import { salesReadService } from "./sales-read-service";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** In-process guard: profit generated once after completion (DEV-110). */
const builtSaleProfitIds = new Set<string>();

function isCompletedSaleStatus(status: SaleStatus): boolean {
  return status === "confirmed" || status === "paid";
}

/**
 * Independent server-side recomputation of a completed sale's frozen COGS
 * and gross profit/margin — sale-cogs-builder.ts / sale-profit-builder.ts
 * compute both entirely in TS with nothing checking them before the sale
 * detail page displays them (V1 plan 1.8). Read-only: rejects the display,
 * never a write.
 */
async function verifySaleCostAndProfit(input: {
  sale_id: string;
  total_cogs: number;
  net_revenue: number;
  gross_profit: number;
  gross_margin_percent: number | null;
}): Promise<ServiceResult<true>> {
  const { data, error } = await supabase.rpc("verify_sale_cost_and_profit", {
    p_sale_id: input.sale_id,
    p_total_cogs: input.total_cogs,
    p_net_revenue: input.net_revenue,
    p_gross_profit: input.gross_profit,
    p_gross_margin_percent: input.gross_margin_percent,
  });

  if (error) {
    return fail(toUserError(error, "Failed to verify sale COGS and profit"));
  }

  if (data !== true) {
    return fail(
      "Sale COGS and profit failed server-side verification and were not shown.",
    );
  }

  return ok(true);
}

async function deriveProfit(
  saleId: string,
  options?: { registerGeneration?: boolean },
): Promise<ServiceResult<SaleProfitSummary>> {
  const trimmed = saleId?.trim() ?? "";
  if (!trimmed || !UUID_RE.test(trimmed)) {
    return fail("Sale id is required.");
  }

  const saleResult = await salesReadService.getSale(trimmed);
  if (saleResult.error || !saleResult.data) {
    return fail(saleResult.error ?? "Failed to load sale");
  }

  const sale = saleResult.data;

  if (!isCompletedSaleStatus(sale.status)) {
    if (sale.status === "draft") {
      return fail("Draft sales do not have frozen profit yet.");
    }
    return fail("Cancelled sales do not have frozen profit.");
  }

  if (options?.registerGeneration && builtSaleProfitIds.has(sale.sale_id)) {
    return fail("Sale profit has already been generated for this sale.");
  }

  const cogsResult = await saleCogsService.getSaleCostSummary(sale.sale_id);
  if (cogsResult.error || !cogsResult.data) {
    return fail(cogsResult.error ?? "Failed to load sale COGS for profit");
  }

  const built = buildSaleProfitSummary({
    sale_id: sale.sale_id,
    sale_status: sale.status,
    net_revenue: sale.subtotal,
    cogs: cogsResult.data.total_cogs,
    alreadyBuiltSaleIds: options?.registerGeneration
      ? [...builtSaleProfitIds]
      : [],
  });

  if (!built.ok) {
    return fail(built.error);
  }

  const verified = await verifySaleCostAndProfit({
    sale_id: built.summary.sale_id,
    total_cogs: cogsResult.data.total_cogs,
    net_revenue: built.summary.net_revenue,
    gross_profit: built.summary.gross_profit,
    gross_margin_percent: built.summary.gross_margin_percent,
  });
  if (verified.error) {
    return fail(verified.error);
  }

  if (options?.registerGeneration) {
    builtSaleProfitIds.add(sale.sale_id);
  }

  return ok(built.summary);
}

export const saleProfitService = {
  buildSaleProfitSummary,
  assertSaleProfitImmutable,

  /**
   * Test/helper: clear in-process duplicate-generation registry.
   */
  clearBuiltSaleProfitRegistry(): void {
    builtSaleProfitIds.clear();
  },

  /**
   * Load frozen profit for a completed sale (idempotent read).
   * Re-derives from frozen subtotal + frozen COGS — never invents new facts.
   */
  async getSaleProfitSummary(
    saleId: string,
  ): Promise<ServiceResult<SaleProfitSummary>> {
    try {
      return await deriveProfit(saleId);
    } catch (error) {
      return fail(toUserError(error, "Failed to load sale profit"));
    }
  },

  /**
   * Generate frozen profit once after sale completion (duplicate-protected).
   */
  async buildFrozenSaleProfit(
    saleId: string,
  ): Promise<ServiceResult<SaleProfitSummary>> {
    try {
      return await deriveProfit(saleId, { registerGeneration: true });
    } catch (error) {
      return fail(toUserError(error, "Failed to build sale profit"));
    }
  },
};
