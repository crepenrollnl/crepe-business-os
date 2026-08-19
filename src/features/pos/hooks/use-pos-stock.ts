"use client";

import { useCallback, useState } from "react";
import { inventoryService } from "@/features/inventory/services/inventory-service";
import type { IngredientWithRelations } from "@/features/inventory/types/inventory";
import { useAsyncEffect } from "@/hooks/use-async-effect";

export function usePosStock() {
  const [items, setItems] = useState<IngredientWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await inventoryService.getInventory();

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
