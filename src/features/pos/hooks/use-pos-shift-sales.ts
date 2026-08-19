"use client";

import { useCallback, useState } from "react";
import { salesReadService } from "@/features/sales/services/sales-read-service";
import type { SaleListItem } from "@/features/sales/types/sale";
import type { Shift } from "@/features/shifts/types/shift";
import { useAsyncEffect } from "@/hooks/use-async-effect";

/**
 * Sales for a shift window. Callers pass `historyShift` from usePosShift:
 * the active shift while open, otherwise the recently closed shift.
 */
export function usePosShiftSales(shift: Shift | null) {
  const [items, setItems] = useState<SaleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const openedAt = shift?.opened_at ?? null;
  const closedAt = shift?.closed_at ?? null;

  const load = useCallback(async () => {
    if (!openedAt) {
      setItems([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const salesResult = await salesReadService.listSalesConfirmedInWindow(
      openedAt,
      closedAt,
    );

    if (salesResult.error || !salesResult.data) {
      setItems([]);
      setError(salesResult.error ?? "Failed to load sales");
      setLoading(false);
      return;
    }

    setItems(salesResult.data);
    setError(null);
    setLoading(false);
  }, [openedAt, closedAt]);

  useAsyncEffect(load, [load]);

  return {
    items,
    loading,
    error,
    retry: load,
  };
}
