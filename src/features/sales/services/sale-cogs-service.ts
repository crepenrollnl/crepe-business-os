/**
 * Sales COGS service (DEV-108).
 *
 * Builds frozen sale cost summaries from Finished Goods consumption ledger
 * rows (DEV-107). Never recalculates unit costs. Never posts Accounting.
 * Never calculates profit.
 *
 * Storage of COGS layers = finished_goods_batch_consumptions (append-only).
 * This service only assembles the frozen sale valuation read model.
 */

import { finishedGoodsReadService } from "@/features/finished-goods/services/finished-goods-read-service";
import { toUserError } from "@/lib/service-errors";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { SaleCogsBatchLayer, SaleCostSummary } from "../types/sale-cogs";
import type { SaleStatus } from "../types/sale";
import {
  assertSaleCogsImmutable,
  buildSaleCostSummary,
} from "../utils/sale-cogs-builder";
import { salesReadService } from "./sales-read-service";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isCompletedSaleStatus(status: SaleStatus): boolean {
  return status === "confirmed" || status === "paid";
}

function mapLayers(
  rows: NonNullable<
    Awaited<
      ReturnType<typeof finishedGoodsReadService.listConsumptionsForSaleLines>
    >["data"]
  >,
): SaleCogsBatchLayer[] {
  return rows.map((row) => ({
    consumption_id: row.consumption_id,
    sale_line_id: row.sale_line_id,
    production_batch_id: row.production_batch_id,
    batch_number: row.batch_number,
    quantity: row.quantity,
    unit_cost: row.unit_cost,
    total_cost: row.total_cost,
    produced_at: row.produced_at,
  }));
}

export const saleCogsService = {
  buildSaleCostSummary,
  assertSaleCogsImmutable,

  /**
   * Load frozen COGS for a completed sale from Finished Goods consumptions.
   * Idempotent: re-reading the same ledger yields the same frozen summary.
   */
  async getSaleCostSummary(
    saleId: string,
  ): Promise<ServiceResult<SaleCostSummary>> {
    try {
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
          return fail("Draft sales do not have frozen COGS yet.");
        }
        return fail("Sale has no Finished Goods consumption layers for COGS.");
      }

      const lineIds = sale.lines.map((line) => line.line_id);
      const consumptionsResult =
        await finishedGoodsReadService.listConsumptionsForSaleLines(lineIds);

      if (consumptionsResult.error || !consumptionsResult.data) {
        return fail(
          consumptionsResult.error ??
            "Failed to load finished goods sale consumptions",
        );
      }

      const built = buildSaleCostSummary({
        sale_id: sale.sale_id,
        sale_status: sale.status,
        layers: mapLayers(consumptionsResult.data),
      });

      if (!built.ok) {
        return fail(built.error);
      }

      return ok(built.summary);
    } catch (error) {
      return fail(toUserError(error, "Failed to load sale COGS"));
    }
  },

  /**
   * Explicit frozen valuation build after sale completion.
   * Same read path as getSaleCostSummary — ledger is the store.
   */
  async buildFrozenSaleValuation(
    saleId: string,
  ): Promise<ServiceResult<SaleCostSummary>> {
    return this.getSaleCostSummary(saleId);
  },
};
