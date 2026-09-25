"use client";

import { useCallback, useState } from "react";
import { authService } from "@/features/auth/services/auth-service";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { inventoryAdjustmentService } from "../services/inventory-adjustment-service";
import {
  canAdjustInventoryStock,
  type RecordInventoryAdjustmentInput,
} from "../types/inventory-adjustment";
import type { IngredientWithRelations } from "../types/inventory";

export function useInventoryAdjustment(options?: {
  onSuccess?: () => Promise<void> | void;
}) {
  const [role, setRole] = useState<string | null>(null);
  const canAdjustStock = canAdjustInventoryStock(role);
  const onSuccess = options?.onSuccess;

  const loadRole = useCallback(async () => {
    setRole(await authService.getMyRole());
  }, []);

  useAsyncEffect(loadRole, [loadRole]);
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
