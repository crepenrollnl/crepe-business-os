"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DEFAULT_PAGE_SIZE } from "@/constants/limits";
import { salesReadService } from "../services/sales-read-service";
import { salesService } from "../services/sales-service";
import type { SaleListItem, SaleStatus } from "../types/sale";

export type SaleSortField =
  | "sale_number"
  | "sale_date"
  | "status"
  | "total";

export type SaleSortDirection = "asc" | "desc";

function compareSales(
  a: SaleListItem,
  b: SaleListItem,
  sortField: SaleSortField,
  sortDirection: SaleSortDirection,
): number {
  const direction = sortDirection === "asc" ? 1 : -1;

  if (sortField === "total") {
    return (a.total - b.total) * direction;
  }

  if (sortField === "status") {
    return a.status.localeCompare(b.status) * direction;
  }

  if (sortField === "sale_number") {
    return (
      a.sale_number.localeCompare(b.sale_number, undefined, {
        sensitivity: "base",
      }) * direction
    );
  }

  return (
    (new Date(a.sale_date).getTime() - new Date(b.sale_date).getTime()) *
    direction
  );
}

async function fetchSalesState() {
  const result = await salesReadService.listSales();

  return {
    items: result.error ? [] : (result.data ?? []),
    error: result.error ?? null,
  };
}

export function useSales() {
  const [items, setItems] = useState<SaleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SaleStatus | "">("");
  const [sortField, setSortField] = useState<SaleSortField>("sale_date");
  const [sortDirection, setSortDirection] =
    useState<SaleSortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const applyState = useCallback(
    (state: Awaited<ReturnType<typeof fetchSalesState>>) => {
      setItems(state.items);
      setError(state.error);
    },
    [],
  );

  const loadSales = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
      }

      const state = await fetchSalesState();
      applyState(state);
      setLoading(false);
    },
    [applyState],
  );

  useEffect(() => {
    void (async () => {
      const state = await fetchSalesState();
      applyState(state);
      setLoading(false);
    })();
  }, [applyState]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = items.filter((item) => {
      const matchesStatus =
        statusFilter.length === 0 || item.status === statusFilter;

      if (!matchesStatus) {
        return false;
      }

      if (normalizedSearch.length === 0) {
        return true;
      }

      const numberMatch = item.sale_number
        .toLowerCase()
        .includes(normalizedSearch);
      const statusMatch = item.status.toLowerCase().includes(normalizedSearch);
      const customerMatch = (item.customer_id ?? "")
        .toLowerCase()
        .includes(normalizedSearch);

      return numberMatch || statusMatch || customerMatch;
    });

    return [...filtered].sort((a, b) =>
      compareSales(a, b, sortField, sortDirection),
    );
  }, [items, search, statusFilter, sortField, sortDirection]);

  const totalFilteredCount = filteredItems.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredCount / pageSize));
  const safePage = Math.min(page, totalPages);

  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, pageSize, safePage]);

  const hasActiveFilters =
    search.trim().length > 0 || statusFilter.length > 0;

  const onSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const onStatusFilterChange = useCallback((value: SaleStatus | "") => {
    setStatusFilter(value);
    setPage(1);
  }, []);

  const onPageSizeChange = useCallback((value: number) => {
    setPageSize(value);
    setPage(1);
  }, []);

  const toggleSort = useCallback(
    (field: SaleSortField) => {
      if (field === sortField) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }

      setSortField(field);
      setSortDirection(field === "sale_date" ? "desc" : "asc");
      setPage(1);
    },
    [sortField],
  );

  const createDraft = useCallback(async () => {
    setCreating(true);
    setActionError(null);

    const result = await salesService.createDraftSale();

    if (result.error || !result.data) {
      setActionError(result.error ?? "Failed to create draft sale");
      setCreating(false);
      return null;
    }

    setCreating(false);
    return result.data.saleId;
  }, []);

  const retry = useCallback(() => {
    void loadSales();
  }, [loadSales]);

  return {
    items: pagedItems,
    totalCount: items.length,
    filteredCount: totalFilteredCount,
    hasActiveFilters,
    loading,
    error,
    search,
    setSearch: onSearchChange,
    statusFilter,
    setStatusFilter: onStatusFilterChange,
    sortField,
    sortDirection,
    toggleSort,
    page: safePage,
    setPage,
    pageSize,
    setPageSize: onPageSizeChange,
    totalPages,
    creating,
    actionError,
    createDraft,
    retry,
  };
}
