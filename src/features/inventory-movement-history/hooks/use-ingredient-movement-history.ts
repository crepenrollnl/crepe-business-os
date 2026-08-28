"use client";

import { useCallback, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { inventoryMovementHistoryService } from "../services/inventory-movement-history-service";
import type { InventoryMovementHistory } from "../types/inventory-movement-history";

export function useIngredientMovementHistory(ingredientId: string) {
  const [items, setItems] = useState<InventoryMovementHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result =
      await inventoryMovementHistoryService.getInventoryMovementHistoryByIngredient(
        ingredientId,
      );

    if (result.error) {
      setItems([]);
      setError(result.error);
      setLoading(false);
      return;
    }

    setItems(result.data ?? []);
    setError(null);
    setLoading(false);
  }, [ingredientId]);

  useAsyncEffect(load, [load]);

  return { items, loading, error, retry: load };
}
