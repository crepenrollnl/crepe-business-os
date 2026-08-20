"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { recipeService } from "@/features/recipes/services/recipe-service";
import { salesReadService } from "@/features/sales/services/sales-read-service";
import { salesService } from "@/features/sales/services/sales-service";
import type { QueuedSale } from "@/features/sales/types/sale";
import { useAsyncEffect } from "@/hooks/use-async-effect";

export const POS_QUEUE_POLL_MS = 15_000;

export interface PosQueueLine {
  product_id: string;
  quantity: number;
  name: string;
}

export interface PosQueueOrder {
  sale_id: string;
  sale_number: string;
  confirmed_at: string | null;
  total: number;
  lines: PosQueueLine[];
}

function productLabel(
  productId: string,
  names: Record<string, string>,
): string {
  return names[productId] ?? productId;
}

function mapQueuedSales(
  sales: QueuedSale[],
  names: Record<string, string>,
): PosQueueOrder[] {
  return sales.map((sale) => ({
    sale_id: sale.sale_id,
    sale_number: sale.sale_number,
    confirmed_at: sale.confirmed_at,
    total: sale.total,
    lines: sale.lines.map((line) => ({
      product_id: line.product_id,
      quantity: line.quantity,
      name: productLabel(line.product_id, names),
    })),
  }));
}

/**
 * Kitchen queue for /pos. Polls every POS_QUEUE_POLL_MS. Recipe names are
 * loaded once per mount; the sales list refreshes on an interval without
 * flipping loading=true (no skeleton flash on background ticks).
 */
export function usePosQueue() {
  const [queuedSales, setQueuedSales] = useState<QueuedSale[]>([]);
  const [recipeNames, setRecipeNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [fulfillingId, setFulfillingId] = useState<string | null>(null);

  const loadNames = useCallback(async () => {
    const result = await recipeService.getRecipes();
    if (result.error || !result.data) {
      return;
    }

    const next: Record<string, string> = {};
    for (const recipe of result.data) {
      next[recipe.id] = recipe.name;
    }
    setRecipeNames(next);
  }, []);

  const loadQueue = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;

    if (!silent) {
      setLoading(true);
    }

    setError(null);

    try {
      const result = await salesReadService.listQueuedSales();

      if (result.error || !result.data) {
        if (!silent) {
          setQueuedSales([]);
        }
        setError(result.error ?? "Failed to load the kitchen queue");
        return;
      }

      setQueuedSales(result.data);
      setError(null);
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useAsyncEffect(loadNames, [loadNames]);
  useAsyncEffect(loadQueue, [loadQueue]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      void loadQueue({ silent: true });
    }, POS_QUEUE_POLL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [loadQueue]);

  const items = useMemo(
    () => mapQueuedSales(queuedSales, recipeNames),
    [queuedSales, recipeNames],
  );

  const markFulfilled = useCallback(async (saleId: string) => {
    setActionError(null);
    setFulfillingId(saleId);

    const result = await salesService.markSaleFulfilled(saleId);

    if (result.error) {
      setActionError(result.error);
      setFulfillingId(null);
      return false;
    }

    setQueuedSales((current) =>
      current.filter((item) => item.sale_id !== saleId),
    );
    setFulfillingId(null);
    return true;
  }, []);

  return {
    items,
    loading,
    error,
    actionError,
    fulfillingId,
    markFulfilled,
    retry: loadQueue,
  };
}
