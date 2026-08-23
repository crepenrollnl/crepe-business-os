"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_PAGE_SIZE } from "@/constants/limits";
import { finishedGoodsListService } from "../services/finished-goods-list-service";
import type { FinishedGoodsListRow } from "../types/finished-good";

export type FinishedGoodsSortField =
  | "product_name"
  | "available_quantity"
  | "average_unit_cost"
  | "remaining_value"
  | "newest_batch_at";

export type FinishedGoodsSortDirection = "asc" | "desc";

function compareRows(
  a: FinishedGoodsListRow,
  b: FinishedGoodsListRow,
  sortField: FinishedGoodsSortField,
  sortDirection: FinishedGoodsSortDirection,
): number {
  const direction = sortDirection === "asc" ? 1 : -1;

  if (sortField === "product_name") {
    return (
      (a.product_name ?? "").localeCompare(b.product_name ?? "", undefined, {
        sensitivity: "base",
      }) * direction
    );
  }

  if (sortField === "newest_batch_at") {
    const aTime = a.newest_batch_at ? new Date(a.newest_batch_at).getTime() : 0;
    const bTime = b.newest_batch_at ? new Date(b.newest_batch_at).getTime() : 0;
    return (aTime - bTime) * direction;
  }

  const aValue = a[sortField] ?? Number.NEGATIVE_INFINITY;
  const bValue = b[sortField] ?? Number.NEGATIVE_INFINITY;
  return (aValue - bValue) * direction;
}

async function fetchFinishedGoodsState() {
  const result = await finishedGoodsListService.listProductAvailability();

  return {
    items: result.error ? [] : (result.data ?? []),
    error: result.error ?? null,
  };
}

export function useFinishedGoods() {
  const [items, setItems] = useState<FinishedGoodsListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] =
    useState<FinishedGoodsSortField>("product_name");
  const [sortDirection, setSortDirection] =
    useState<FinishedGoodsSortDirection>("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const applyState = useCallback(
    (state: Awaited<ReturnType<typeof fetchFinishedGoodsState>>) => {
      setItems(state.items);
      setError(state.error);
    },
    [],
  );

  const loadItems = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
      }

      const state = await fetchFinishedGoodsState();
      applyState(state);
      setLoading(false);
    },
    [applyState],
  );

  useEffect(() => {
    void (async () => {
      const state = await fetchFinishedGoodsState();
      applyState(state);
      setLoading(false);
    })();
  }, [applyState]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered =
      normalizedSearch.length === 0
        ? items
        : items.filter((item) =>
            (item.product_name ?? "")
              .toLowerCase()
              .includes(normalizedSearch),
          );

    return [...filtered].sort((a, b) =>
      compareRows(a, b, sortField, sortDirection),
    );
  }, [items, search, sortField, sortDirection]);

  const totalFilteredCount = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize));
  const safePage = Math.min(page, totalPages);

  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, pageSize, safePage]);

  const onSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const onPageSizeChange = useCallback((value: number) => {
    setPageSize(value);
    setPage(1);
  }, []);

  const toggleSort = useCallback(
    (field: FinishedGoodsSortField) => {
      if (field === sortField) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }

      setSortField(field);
      setSortDirection(field === "newest_batch_at" ? "desc" : "asc");
      setPage(1);
    },
    [sortField],
  );

  const retry = useCallback(() => {
    void loadItems();
  }, [loadItems]);

  return {
    items: pagedItems,
    totalCount: items.length,
    filteredCount: totalFilteredCount,
    hasActiveFilters: search.trim().length > 0,
    loading,
    error,
    search,
    setSearch: onSearchChange,
    sortField,
    sortDirection,
    toggleSort,
    page: safePage,
    setPage,
    pageSize,
    setPageSize: onPageSizeChange,
    totalPages,
    retry,
  };
}
