"use client";

import { useCallback, useMemo, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { inventoryService } from "../services/inventory-service";
import type {
  IngredientCategory,
  IngredientStockLevel,
  IngredientStockSortField,
  InventorySortDirection,
} from "../types/inventory";

function compareStockLevels(
  a: IngredientStockLevel,
  b: IngredientStockLevel,
  sortField: IngredientStockSortField,
  sortDirection: InventorySortDirection,
): number {
  const direction = sortDirection === "asc" ? 1 : -1;

  if (sortField === "name") {
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) * direction;
  }

  return (a[sortField] - b[sortField]) * direction;
}

/**
 * Seller Inventory: ingredient quantities only, read from the cost-free
 * ingredient_stock_levels view (sql/155). Never reads ingredients, suppliers,
 * stock_movements or purchase history.
 */
export function useIngredientStockLevels() {
  const [items, setItems] = useState<IngredientStockLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortField, setSortField] = useState<IngredientStockSortField>("name");
  const [sortDirection, setSortDirection] =
    useState<InventorySortDirection>("asc");

  const load = useCallback(async () => {
    setLoading(true);

    const result = await inventoryService.getStockLevels();

    if (result.error || !result.data) {
      setItems([]);
      setError(result.error ?? "Failed to load stock levels");
      setLoading(false);
      return;
    }

    setItems(result.data);
    setError(null);
    setLoading(false);
  }, []);

  useAsyncEffect(load, [load]);

  /** Categories that actually occur, for the filter (no extra request). */
  const categories = useMemo<IngredientCategory[]>(() => {
    const byId = new Map<string, IngredientCategory>();
    for (const item of items) {
      if (item.category) {
        byId.set(item.category.id, item.category);
      }
    }
    return [...byId.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = items.filter((item) => {
      if (categoryFilter.length > 0 && item.category_id !== categoryFilter) {
        return false;
      }
      if (normalizedSearch.length === 0) {
        return true;
      }
      return (
        item.name.toLowerCase().includes(normalizedSearch) ||
        (item.category?.name ?? "").toLowerCase().includes(normalizedSearch)
      );
    });

    return [...filtered].sort((a, b) =>
      compareStockLevels(a, b, sortField, sortDirection),
    );
  }, [items, search, categoryFilter, sortField, sortDirection]);

  const toggleSort = useCallback(
    (field: IngredientStockSortField) => {
      if (field === sortField) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }
      setSortField(field);
      setSortDirection("asc");
    },
    [sortField],
  );

  return {
    items: filteredItems,
    totalCount: items.length,
    hasActiveFilters: search.trim().length > 0 || categoryFilter.length > 0,
    categories,
    loading,
    error,
    search,
    setSearch,
    categoryFilter,
    setCategoryFilter,
    sortField,
    sortDirection,
    toggleSort,
    retry: load,
  };
}
