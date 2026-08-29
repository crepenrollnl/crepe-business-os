"use client";

import { useCallback, useState } from "react";
import { listSaleableNow } from "@/features/sales/services/saleable-now-service";
import type { SaleableNowRow } from "@/features/sales/utils/max-saleable-now";
import { useAsyncEffect } from "@/hooks/use-async-effect";

export function useSaleableNow() {
  const [rows, setRows] = useState<SaleableNowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await listSaleableNow();

    if (result.error || !result.data) {
      setRows([]);
      setError(result.error ?? "Failed to load saleable quantities");
      setLoading(false);
      return;
    }

    setRows(result.data);
    setError(null);
    setLoading(false);
  }, []);

  useAsyncEffect(load, [load]);

  return {
    rows,
    loading,
    error,
    retry: load,
  };
}
