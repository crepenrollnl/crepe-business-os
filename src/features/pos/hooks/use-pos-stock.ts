"use client";

import { useCallback, useState } from "react";
import { inventoryService } from "@/features/inventory/services/inventory-service";
import type { IngredientStockLevel } from "@/features/inventory/types/inventory";
import { useAsyncEffect } from "@/hooks/use-async-effect";

/** POS stock tab: quantities only (ingredient_stock_levels, sql/155). */
export function usePosStock() {
  const [items, setItems] = useState<IngredientStockLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await inventoryService.getStockLevels();

    if (result.error || !result.data) {
      setItems([]);
      setError(result.error ?? "Failed to load inventory");
      setLoading(false);
      return;
    }

    setItems(result.data);
    setError(null);
    setLoading(false);
  }, []);

  useAsyncEffect(load, [load]);

  return {
    items,
    loading,
    error,
    retry: load,
  };
}
