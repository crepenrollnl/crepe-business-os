/**
 * Finished Goods Inventory Valuation service (DEV-104).
 *
 * Reads valuation from finished_goods_batch_availability.
 * Valuation identity is the Production Batch (frozen unit_cost).
 * Remaining quantity / remaining value are calculated — never stored.
 *
 * Does NOT update production_batches or recalculate unit_cost.
 */

import { toUserError } from "@/lib/service-errors";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { FinishedGoodsBatchValuation } from "../utils/finished-goods-valuation";
import {
  assignFinishedGoodsInventoryValuation,
  findDuplicateFinishedGoodsValuations,
} from "../utils/finished-goods-valuation";
import { finishedGoodsReadService } from "./finished-goods-read-service";

export const finishedGoodsValuationService = {
  /**
   * Build valuation for one completed production batch lot.
   */
  async getBatchValuation(
    productionBatchId: string,
  ): Promise<ServiceResult<FinishedGoodsBatchValuation>> {
    try {
      const batchResult =
        await finishedGoodsReadService.getAvailableBatch(productionBatchId);

      if (batchResult.error || !batchResult.data) {
        return fail(
          batchResult.error ?? "Finished goods batch was not found.",
        );
      }

      const batch = batchResult.data;
      const assigned = assignFinishedGoodsInventoryValuation({
        production_batch_id: batch.production_batch_id,
        produced_quantity: batch.produced_quantity,
        available_quantity: batch.available_quantity,
        unit_cost: batch.unit_cost,
        total_batch_cost: batch.total_batch_cost,
        remaining_value: batch.remaining_value,
      });

      if (!assigned.ok) {
        return fail(assigned.error);
      }

      return ok(assigned.valuation);
    } catch (error) {
      return fail(
        toUserError(error, "Failed to load finished goods batch valuation"),
      );
    }
  },

  /**
   * List valuations for a finished good (or all lots).
   * Enforces one valuation identity per production batch.
   */
  async listBatchValuations(
    productId?: string,
  ): Promise<ServiceResult<FinishedGoodsBatchValuation[]>> {
    try {
      const listResult =
        await finishedGoodsReadService.listAvailableBatches(productId);

      if (listResult.error || !listResult.data) {
        return fail(
          listResult.error ?? "Failed to load finished goods availability",
        );
      }

      const valuations: FinishedGoodsBatchValuation[] = [];

      for (const batch of listResult.data) {
        const assigned = assignFinishedGoodsInventoryValuation({
          production_batch_id: batch.production_batch_id,
          produced_quantity: batch.produced_quantity,
          available_quantity: batch.available_quantity,
          unit_cost: batch.unit_cost,
          total_batch_cost: batch.total_batch_cost,
          remaining_value: batch.remaining_value,
        });

        if (!assigned.ok) {
          return fail(assigned.error);
        }

        valuations.push(assigned.valuation);
      }

      const duplicateError = findDuplicateFinishedGoodsValuations(valuations);
      if (duplicateError) {
        return fail(duplicateError);
      }

      return ok(valuations);
    } catch (error) {
      return fail(
        toUserError(error, "Failed to load finished goods valuations"),
      );
    }
  },
};
