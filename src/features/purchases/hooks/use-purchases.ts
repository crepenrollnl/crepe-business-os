"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { purchaseService } from "../services/purchase-service";
import type {
  PurchaseFormValues,
  PurchaseIngredientOption,
  PurchaseListItem,
  PurchaseSortDirection,
  PurchaseSortField,
  PurchaseStatus,
  PurchaseSupplier,
  PurchaseWithRelations,
} from "../types/purchase";

function comparePurchases(
  a: PurchaseListItem,
  b: PurchaseListItem,
  sortField: PurchaseSortField,
  sortDirection: PurchaseSortDirection,
): number {
  const direction = sortDirection === "asc" ? 1 : -1;

  if (sortField === "total") {
    return (a.total - b.total) * direction;
  }

  if (sortField === "status") {
    return a.status.localeCompare(b.status) * direction;
  }

  if (sortField === "invoice_number") {
    return (
      (a.invoice_number ?? "").localeCompare(b.invoice_number ?? "", undefined, {
        sensitivity: "base",
      }) * direction
    );
  }

  return (
    new Date(a.purchased_at).getTime() - new Date(b.purchased_at).getTime()
  ) * direction;
}

async function fetchPurchasesState() {
  const [purchasesResult, suppliersResult, ingredientsResult] =
    await Promise.all([
      purchaseService.getPurchases(),
      purchaseService.getSuppliers(),
      purchaseService.getIngredients(),
    ]);

  return {
    items: purchasesResult.error ? [] : (purchasesResult.data ?? []),
    suppliers: suppliersResult.error ? [] : (suppliersResult.data ?? []),
    ingredients: ingredientsResult.error ? [] : (ingredientsResult.data ?? []),
    error:
      purchasesResult.error ??
      suppliersResult.error ??
      ingredientsResult.error ??
      null,
  };
}

function emptyFormValues(): PurchaseFormValues {
  return {
    supplier_id: "",
    invoice_number: "",
    purchased_at: new Date().toISOString().slice(0, 10),
    notes: "",
    lines: [{ ingredient_id: "", quantity: 1, unit_cost: 0 }],
  };
}

function purchaseToFormValues(purchase: PurchaseWithRelations): PurchaseFormValues {
  return {
    supplier_id: purchase.supplier_id ?? "",
    invoice_number: purchase.invoice_number ?? "",
    purchased_at: purchase.purchased_at.slice(0, 10),
    notes: purchase.notes ?? "",
    lines:
      purchase.items.length > 0
        ? purchase.items.map((item) => ({
            ingredient_id: item.ingredient_id,
            quantity: item.quantity,
            unit_cost: item.unit_cost,
          }))
        : [{ ingredient_id: "", quantity: 1, unit_cost: 0 }],
  };
}

export function usePurchases() {
  const [items, setItems] = useState<PurchaseListItem[]>([]);
  const [suppliers, setSuppliers] = useState<PurchaseSupplier[]>([]);
  const [ingredients, setIngredients] = useState<PurchaseIngredientOption[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<PurchaseStatus | "">("");
  const [sortField, setSortField] = useState<PurchaseSortField>("purchased_at");
  const [sortDirection, setSortDirection] =
    useState<PurchaseSortDirection>("desc");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] =
    useState<PurchaseWithRelations | null>(null);
  const [isLoadingPurchase, setIsLoadingPurchase] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const openedFromQueryRef = useRef(false);

  const applyState = useCallback(
    (state: Awaited<ReturnType<typeof fetchPurchasesState>>) => {
      setItems(state.items);
      setSuppliers(state.suppliers);
      setIngredients(state.ingredients);
      setError(state.error);
    },
    [],
  );

  const loadPurchases = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
      }

      const state = await fetchPurchasesState();
      applyState(state);
      setLoading(false);
    },
    [applyState],
  );

  useEffect(() => {
    void (async () => {
      const state = await fetchPurchasesState();
      applyState(state);
      setLoading(false);
    })();
  }, [applyState]);

  const filteredItems = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    const filtered = items.filter((item) => {
      const matchesSupplier =
        supplierFilter.length === 0 || item.supplier_id === supplierFilter;
      const matchesStatus =
        statusFilter.length === 0 || item.status === statusFilter;

      if (!matchesSupplier || !matchesStatus) {
        return false;
      }

      if (normalizedSearch.length === 0) {
        return true;
      }

      const invoiceMatch = (item.invoice_number ?? "")
        .toLowerCase()
        .includes(normalizedSearch);
      const supplierMatch = (item.supplier?.name ?? "")
        .toLowerCase()
        .includes(normalizedSearch);
      const notesMatch = (item.notes ?? "")
        .toLowerCase()
        .includes(normalizedSearch);
      const statusMatch = item.status.toLowerCase().includes(normalizedSearch);

      return invoiceMatch || supplierMatch || notesMatch || statusMatch;
    });

    return [...filtered].sort((a, b) =>
      comparePurchases(a, b, sortField, sortDirection),
    );
  }, [items, search, supplierFilter, statusFilter, sortField, sortDirection]);

  const hasActiveFilters =
    search.trim().length > 0 ||
    supplierFilter.length > 0 ||
    statusFilter.length > 0;

  const toggleSort = useCallback(
    (field: PurchaseSortField) => {
      if (field === sortField) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }

      setSortField(field);
      setSortDirection(field === "purchased_at" ? "desc" : "asc");
    },
    [sortField],
  );

  const openCreateModal = useCallback(() => {
    setEditingPurchase(null);
    setActionError(null);
    setIsModalOpen(true);
  }, []);

  const openPurchaseById = useCallback(async (purchaseId: string) => {
    setActionError(null);
    setEditingPurchase(null);
    setIsLoadingPurchase(true);
    setIsModalOpen(true);

    const result = await purchaseService.getPurchaseById(purchaseId);

    if (result.error || !result.data) {
      setActionError(result.error ?? "Failed to load purchase");
      setEditingPurchase(null);
      setIsLoadingPurchase(false);
      return;
    }

    setEditingPurchase(result.data);
    setIsLoadingPurchase(false);
  }, []);

  const openPurchaseModal = useCallback(
    async (item: PurchaseListItem) => {
      await openPurchaseById(item.id);
    },
    [openPurchaseById],
  );

  useEffect(() => {
    if (openedFromQueryRef.current || loading || typeof window === "undefined") {
      return;
    }

    const openId = new URLSearchParams(window.location.search).get("open");

    if (!openId) {
      return;
    }

    openedFromQueryRef.current = true;

    // Defer so modal open state is not set synchronously inside the effect body.
    const timerId = window.setTimeout(() => {
      void openPurchaseById(openId);
    }, 0);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [loading, openPurchaseById]);

  const closeModal = useCallback(() => {
    if (isSaving) {
      return;
    }

    setIsModalOpen(false);
    setEditingPurchase(null);
    setActionError(null);
    setIsLoadingPurchase(false);
  }, [isSaving]);

  const saveDraft = useCallback(
    async (values: PurchaseFormValues) => {
      setIsSaving(true);
      setActionError(null);

      const result = await purchaseService.saveDraft({
        ...values,
        id: editingPurchase?.id,
      });

      if (result.error) {
        setActionError(result.error);
        setIsSaving(false);
        return false;
      }

      await loadPurchases({ silent: true });
      setIsSaving(false);
      closeModal();
      return true;
    },
    [closeModal, editingPurchase?.id, loadPurchases],
  );

  const receiveGoods = useCallback(
    async (values: PurchaseFormValues) => {
      setIsSaving(true);
      setActionError(null);

      const result = await purchaseService.receivePurchase({
        ...values,
        id: editingPurchase?.id,
      });

      if (result.error) {
        setActionError(result.error);
        setIsSaving(false);
        return false;
      }

      await loadPurchases({ silent: true });
      setIsSaving(false);
      closeModal();
      return true;
    },
    [closeModal, editingPurchase?.id, loadPurchases],
  );

  return {
    items: filteredItems,
    totalCount: items.length,
    hasActiveFilters,
    suppliers,
    ingredients,
    loading,
    error,
    search,
    setSearch,
    supplierFilter,
    setSupplierFilter,
    statusFilter,
    setStatusFilter,
    sortField,
    sortDirection,
    toggleSort,
    isModalOpen,
    editingPurchase,
    initialFormValues: editingPurchase
      ? purchaseToFormValues(editingPurchase)
      : emptyFormValues(),
    isLoadingPurchase,
    isSaving,
    actionError,
    openCreateModal,
    openPurchaseModal,
    closeModal,
    saveDraft,
    receiveGoods,
    retry: () => loadPurchases(),
  };
}
