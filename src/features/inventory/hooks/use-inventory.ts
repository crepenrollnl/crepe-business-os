"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { inventoryService } from "../services/inventory-service";
import type {
  IngredientCategory,
  IngredientFormValues,
  IngredientWithRelations,
  InventorySortDirection,
  InventorySortField,
  Supplier,
} from "../types/inventory";

function compareInventoryItems(
  a: IngredientWithRelations,
  b: IngredientWithRelations,
  sortField: InventorySortField,
  sortDirection: InventorySortDirection,
): number {
  const direction = sortDirection === "asc" ? 1 : -1;

  if (sortField === "name") {
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) * direction;
  }

  return (a[sortField] - b[sortField]) * direction;
}

async function fetchInventoryState() {
  const [inventoryResult, categoriesResult, suppliersResult] = await Promise.all([
    inventoryService.getInventory(),
    inventoryService.getCategories(),
    inventoryService.getSuppliers(),
  ]);

  return {
    items: inventoryResult.error ? [] : (inventoryResult.data ?? []),
    categories: categoriesResult.error ? [] : (categoriesResult.data ?? []),
    suppliers: suppliersResult.error ? [] : (suppliersResult.data ?? []),
    error:
      inventoryResult.error ??
      categoriesResult.error ??
      suppliersResult.error ??
      null,
  };
}

export function useInventory() {
  const [items, setItems] = useState<IngredientWithRelations[]>([]);
  const [categories, setCategories] = useState<IngredientCategory[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortField, setSortField] = useState<InventorySortField>("name");
  const [sortDirection, setSortDirection] =
    useState<InventorySortDirection>("asc");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<IngredientWithRelations | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] = useState<IngredientWithRelations | null>(
    null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const applyInventoryState = useCallback(
    (state: Awaited<ReturnType<typeof fetchInventoryState>>) => {
      setItems(state.items);
      setCategories(state.categories);
      setSuppliers(state.suppliers);
      setError(state.error);
    },
    [],
  );

  const loadInventory = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
      }

      const state = await fetchInventoryState();
      applyInventoryState(state);
      setLoading(false);
    },
    [applyInventoryState],
  );

  useEffect(() => {
    void (async () => {
      const state = await fetchInventoryState();
      applyInventoryState(state);
      setLoading(false);
    })();
  }, [applyInventoryState]);

  const itemsWithRelations = useMemo(() => {
    const categoryMap = new Map(
      categories.map((category) => [category.id, category]),
    );
    const supplierMap = new Map(
      suppliers.map((supplier) => [supplier.id, supplier]),
    );

    return items.map((item) => {
      const categoryFromRelation =
        item.category && typeof item.category.name === "string"
          ? item.category
          : null;
      const supplierFromRelation =
        item.supplier && typeof item.supplier.name === "string"
          ? item.supplier
          : null;

      return {
        ...item,
        category:
          categoryFromRelation ??
          (item.category_id
            ? (categoryMap.get(item.category_id) ?? null)
            : null),
        supplier:
          supplierFromRelation ??
          (item.supplier_id
            ? (supplierMap.get(item.supplier_id) ?? null)
            : null),
      };
    });
  }, [items, categories, suppliers]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = itemsWithRelations.filter((item) => {
      const matchesCategory =
        categoryFilter.length === 0 || item.category_id === categoryFilter;

      if (!matchesCategory) {
        return false;
      }

      if (normalizedSearch.length === 0) {
        return true;
      }

      const nameMatch = item.name.toLowerCase().includes(normalizedSearch);
      const categoryMatch = (item.category?.name ?? "")
        .toLowerCase()
        .includes(normalizedSearch);
      const supplierMatch = (item.supplier?.name ?? "")
        .toLowerCase()
        .includes(normalizedSearch);

      return nameMatch || categoryMatch || supplierMatch;
    });

    return [...filtered].sort((a, b) =>
      compareInventoryItems(a, b, sortField, sortDirection),
    );
  }, [itemsWithRelations, search, categoryFilter, sortField, sortDirection]);

  const hasActiveFilters =
    search.trim().length > 0 || categoryFilter.length > 0;

  const toggleSort = useCallback(
    (field: InventorySortField) => {
      if (field === sortField) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }

      setSortField(field);
      setSortDirection("asc");
    },
    [sortField],
  );

  const openCreateModal = useCallback(() => {
    setEditingItem(null);
    setActionError(null);
    setIsModalOpen(true);
  }, []);

  const openEditModal = useCallback((item: IngredientWithRelations) => {
    setEditingItem(item);
    setActionError(null);
    setIsModalOpen(true);
  }, []);

  const closeModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingItem(null);
    setActionError(null);
  }, []);

  const openDeleteDialog = useCallback((item: IngredientWithRelations) => {
    setDeleteTarget(item);
    setActionError(null);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setDeleteTarget(null);
    setActionError(null);
  }, []);

  const saveIngredient = useCallback(
    async (values: IngredientFormValues) => {
      setIsSaving(true);
      setActionError(null);

      const result = editingItem
        ? await inventoryService.updateIngredient(editingItem.id, values)
        : await inventoryService.createIngredient(values);

      if (result.error) {
        setActionError(result.error);
        setIsSaving(false);
        return false;
      }

      await loadInventory({ silent: true });
      setIsSaving(false);
      closeModal();
      return true;
    },
    [closeModal, editingItem, loadInventory],
  );

  const deleteIngredient = useCallback(async () => {
    if (!deleteTarget) {
      return false;
    }

    setIsDeleting(true);
    setActionError(null);

    const result = await inventoryService.deleteIngredient(deleteTarget.id);

    if (result.error) {
      setActionError(result.error);
      setIsDeleting(false);
      return false;
    }

    await loadInventory({ silent: true });
    setIsDeleting(false);
    closeDeleteDialog();
    return true;
  }, [closeDeleteDialog, deleteTarget, loadInventory]);

  return {
    items: filteredItems,
    totalCount: items.length,
    hasActiveFilters,
    categories,
    suppliers,
    loading,
    error,
    search,
    setSearch,
    categoryFilter,
    setCategoryFilter,
    sortField,
    sortDirection,
    toggleSort,
    isModalOpen,
    editingItem,
    deleteTarget,
    isSaving,
    isDeleting,
    actionError,
    openCreateModal,
    openEditModal,
    closeModal,
    openDeleteDialog,
    closeDeleteDialog,
    saveIngredient,
    deleteIngredient,
    retry: () => loadInventory(),
  };
}
