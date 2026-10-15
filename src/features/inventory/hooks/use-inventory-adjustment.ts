"use client";

import { useCallback, useState } from "react";
import { useRole } from "@/hooks/use-role";
import { canSeeCosts } from "@/lib/roles";
import { inventoryAdjustmentService } from "../services/inventory-adjustment-service";
import type { RecordInventoryAdjustmentInput } from "../types/inventory-adjustment";
import type { IngredientWithRelations } from "../types/inventory";

export function useInventoryAdjustment(options?: {
  onSuccess?: () => Promise<void> | void;
}) {
  const { role } = useRole();
  // record_inventory_adjustment is owner/partner only (sql/125).
  const canAdjustStock = canSeeCosts(role);
  const onSuccess = options?.onSuccess;
  const [adjustingItem, setAdjustingItem] =
    useState<IngredientWithRelations | null>(null);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);

  const openAdjustModal = useCallback((item: IngredientWithRelations) => {
    setAdjustingItem(item);
    setAdjustError(null);
  }, []);

  const closeAdjustModal = useCallback(() => {
    if (isAdjusting) {
      return;
    }

    setAdjustingItem(null);
    setAdjustError(null);
  }, [isAdjusting]);

  const submitAdjustment = useCallback(
    async (input: RecordInventoryAdjustmentInput) => {
      setIsAdjusting(true);
      setAdjustError(null);

      const result = await inventoryAdjustmentService.recordAdjustment(input);

      if (result.error) {
        setAdjustError(result.error);
        setIsAdjusting(false);
        return false;
      }

      await onSuccess?.();
      setIsAdjusting(false);
      setAdjustingItem(null);
      setAdjustError(null);
      return true;
    },
    [onSuccess],
  );

  return {
    canAdjustStock,
    adjustingItem,
    isAdjustModalOpen: adjustingItem !== null,
    isAdjusting,
    adjustError,
    openAdjustModal,
    closeAdjustModal,
    submitAdjustment,
  };
}
