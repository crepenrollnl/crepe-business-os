/**
 * Finished Goods Batch Consumption service (DEV-107).
 *
 * Sale-line inventory movement:
 *   validate → allocate_finished_goods_fifo (SQL FIFO) → reload remaining
 *
 * Does NOT:
 *   - calculate sale COGS / profit
 *   - create accounting postings
 *   - mutate production_batches
 *   - implement FIFO in TypeScript for persistence (SQL owns writes)
 *
 * Sales Confirm continues to use confirm_sale (atomic multi-line).
 * This service is the Finished Goods inventory-movement API for a single
 * sale line / source, reusing the same FIFO ledger.
 */

import { toUserError } from "@/lib/service-errors";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  ConsumeFinishedGoodsForSaleInput,
  ConsumeFinishedGoodsForSaleResult,
  FinishedGoodsConsumptionLayer,
} from "../types/finished-goods-consumption";
import {
  assertUniqueConsumptionSource,
  consumptionSourceKey,
  planFifoBatchConsumption,
  validateConsumptionQuantity,
} from "../utils/finished-goods-batch-consumption";
import { finishedGoodsReadService } from "./finished-goods-read-service";
import { finishedGoodsService } from "./finished-goods-service";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateSaleConsumptionInput(
  input: ConsumeFinishedGoodsForSaleInput,
): string | null {
  if (!input.product_id || !UUID_RE.test(input.product_id.trim())) {
    return "Product id is required.";
  }

  const quantityError = validateConsumptionQuantity(Number(input.quantity));
  if (quantityError) {
    return quantityError;
  }

  if (!input.sale_line_id || !UUID_RE.test(input.sale_line_id.trim())) {
    return "Source id is required.";
  }

  return null;
}

function mapLayersFromAllocation(layers: readonly {
  production_batch_id: string;
  quantity: number;
  unit_cost: number;
  produced_at: string;
}[]): FinishedGoodsConsumptionLayer[] {
  return layers.map((layer) => ({
    production_batch_id: layer.production_batch_id,
    quantity: layer.quantity,
    unit_cost: layer.unit_cost,
    produced_at: layer.produced_at,
  }));
}

export const finishedGoodsConsumptionService = {
  consumptionSourceKey,
  planFifoBatchConsumption,
  validateConsumptionQuantity,
  assertUniqueConsumptionSource,

  /**
   * Consume finished goods for one sale line via FIFO ledger append.
   * Reloads calculated remaining quantity/value afterward.
   */
  async consumeForSale(
    input: ConsumeFinishedGoodsForSaleInput,
    options?: {
      /**
       * Optional in-memory duplicate guard (e.g. session already-allocated keys).
       * SQL still enforces uniqueness on persist.
       */
      alreadyAllocatedSourceKeys?: readonly string[];
    },
  ): Promise<ServiceResult<ConsumeFinishedGoodsForSaleResult>> {
    try {
      const validationError = validateSaleConsumptionInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const productId = input.product_id.trim();
      const saleLineId = input.sale_line_id.trim();
      const quantity = Number(input.quantity);

      const duplicateError = assertUniqueConsumptionSource(
        "sale_line",
        saleLineId,
        options?.alreadyAllocatedSourceKeys ?? [],
      );
      if (duplicateError) {
        return fail(duplicateError);
      }

      // Advisory availability check — same FIFO plan Sales would expect.
      // Persistence still goes through allocate_finished_goods_fifo only.
      const availabilityResult =
        await finishedGoodsReadService.listAvailableBatches(productId);
      if (availabilityResult.error || !availabilityResult.data) {
        return fail(
          availabilityResult.error ??
            "Failed to load finished goods availability",
        );
      }

      const plan = planFifoBatchConsumption(
        availabilityResult.data,
        quantity,
      );
      if (!plan.ok) {
        return fail(plan.error);
      }

      const allocateResult = await finishedGoodsService.allocateFinishedGoods({
        product_id: productId,
        quantity,
        reason: "sale",
        source_type: "sale_line",
        source_id: saleLineId,
        notes: input.notes ?? null,
      });

      if (allocateResult.error || !allocateResult.data) {
        return fail(
          allocateResult.error ?? "Failed to allocate finished goods.",
        );
      }

      const remainingResult =
        await finishedGoodsReadService.listAvailableBatches(productId);
      if (remainingResult.error || !remainingResult.data) {
        return fail(
          remainingResult.error ??
            "Failed to reload finished goods availability",
        );
      }

      const allocation = allocateResult.data.allocation;

      return ok({
        product_id: productId,
        sale_line_id: saleLineId,
        requested_quantity: quantity,
        allocated_quantity: allocation.allocated_quantity,
        layers: mapLayersFromAllocation(allocation.allocations),
        remaining_batches: remainingResult.data,
      });
    } catch (error) {
      return fail(
        toUserError(error, "Failed to consume finished goods."),
      );
    }
  },
};
