"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { productionExecutionService } from "../services/production-execution-service";
import type {
  ExecutableProductionPlan,
  ProductionExecutionSortDirection,
  ProductionExecutionSortField,
} from "../types/production-execution";
import { getLastCalculatedAt } from "../utils/format-execution-plan";

function comparePlans(
  a: ExecutableProductionPlan,
  b: ExecutableProductionPlan,
  sortField: ProductionExecutionSortField,
  sortDirection: ProductionExecutionSortDirection,
): number {
  const direction = sortDirection === "asc" ? 1 : -1;

  if (sortField === "name") {
    return a.name.localeCompare(b.name) * direction;
  }

  if (sortField === "product_count") {
    return (a.product_count - b.product_count) * direction;
  }

  if (sortField === "status") {
    return a.status.localeCompare(b.status) * direction;
  }

  if (sortField === "last_calculated_at") {
    return (
      (new Date(getLastCalculatedAt(a)).getTime() -
        new Date(getLastCalculatedAt(b)).getTime()) *
      direction
    );
  }

  return (
    (new Date(a.planning_date).getTime() -
      new Date(b.planning_date).getTime()) *
    direction
  );
}

async function fetchQueueState() {
  const result = await productionExecutionService.getExecutablePlans();

  return {
    items: result.error ? [] : (result.data ?? []),
    error: result.error ?? null,
  };
}

export function useProductionExecution() {
  const router = useRouter();
  const [items, setItems] = useState<ExecutableProductionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] =
    useState<ProductionExecutionSortField>("planning_date");
  const [sortDirection, setSortDirection] =
    useState<ProductionExecutionSortDirection>("desc");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const applyState = useCallback(
    (state: Awaited<ReturnType<typeof fetchQueueState>>) => {
      setItems(state.items);
      setError(state.error);
    },
    [],
  );

  useEffect(() => {
    void (async () => {
      const state = await fetchQueueState();
      applyState(state);
      setLoading(false);
    })();
  }, [applyState]);

  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) =>
        comparePlans(a, b, sortField, sortDirection),
      ),
    [items, sortField, sortDirection],
  );

  const toggleSort = useCallback(
    (field: ProductionExecutionSortField) => {
      if (field === sortField) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }

      setSortField(field);
      setSortDirection(field === "name" ? "asc" : "desc");
    },
    [sortField],
  );

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    const state = await fetchQueueState();
    applyState(state);
    setIsRefreshing(false);
  }, [applyState]);

  const openPlan = useCallback(
    (item: ExecutableProductionPlan) => {
      router.push(`/production-execution/${item.id}`);
    },
    [router],
  );

  const retry = useCallback(() => {
    void (async () => {
      setLoading(true);
      const state = await fetchQueueState();
      applyState(state);
      setLoading(false);
    })();
  }, [applyState]);

  return {
    items: sortedItems,
    loading,
    error,
    sortField,
    sortDirection,
    isRefreshing,
    toggleSort,
    refresh,
    openPlan,
    retry,
  };
}
