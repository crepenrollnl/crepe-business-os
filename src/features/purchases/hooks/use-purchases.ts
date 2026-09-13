"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { purchaseService } from "../services/purchase-service";
import { purchaseTaxService } from "../services/purchase-tax-service";
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
import type { PurchaseAccountingPreviewData } from "../types/purchase-accounting-preview";
import type { PurchaseTaxResult } from "../types/purchase-tax";
import { accountingContextService } from "@/features/accounting/services/accounting-context-service";
import { buildPurchaseTaxDocument } from "../utils/build-purchase-tax-document";
import { purchaseToFormValues } from "../utils/map-purchase-form-values";
import {
  mapPurchaseJournalPostingToPreview,
  mapPurchaseTotalsToAccountingPreview,
} from "../utils/map-purchase-accounting-preview";
import { toNetPurchaseLines } from "../utils/to-net-purchase-lines";

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
    supplier_country: "NL",
    tax_country: "NL",
    lines: [
      {
        ingredient_id: "",
        quantity: 1,
        unit_cost: 0,
        discount: 0,
        tax_category: "food",
        tax_regime: "reduced_vat",
        price_mode: "inclusive",
      },
    ],
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
  const [postingError, setPostingError] = useState<string | null>(null);
  const [accountingPreview, setAccountingPreview] =
    useState<PurchaseAccountingPreviewData | null>(null);
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
    setAccountingPreview(null);
    setActionError(null);
    setPostingError(null);
    setIsModalOpen(true);
  }, []);

  const openPurchaseById = useCallback(async (purchaseId: string) => {
    setActionError(null);
    setPostingError(null);
    setEditingPurchase(null);
    setAccountingPreview(null);
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
    // Document totals only — journal proposals are not persisted. Only
    // show this persisted DB snapshot for purchases that are no longer
    // editable (received/cancelled — same condition as `isReadOnly` in
    // purchase-document-modal.tsx). For an editable draft, leave this
    // null so the modal's live tax preview (which recalculates on every
    // line edit) always drives the Subtotal/Tax total/Grand total —
    // otherwise this frozen DB snapshot from load time permanently wins
    // over the `??` fallback and the footer totals stop updating the
    // moment the user adds/edits a line in a reopened draft.
    const isEditable =
      result.data.status !== "received" && result.data.status !== "cancelled";
    setAccountingPreview(
      isEditable ? null : mapPurchaseTotalsToAccountingPreview(result.data),
    );
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
    setAccountingPreview(null);
    setActionError(null);
    setPostingError(null);
    setIsLoadingPurchase(false);
  }, [isSaving]);

  const resolvePurchaseTax = useCallback(
    async (
      values: PurchaseFormValues,
    ): Promise<{ tax: PurchaseTaxResult | null; error: string | null }> => {
      const taxDocument = buildPurchaseTaxDocument({
        values,
        suppliers,
        documentId: editingPurchase?.id,
      });
      const taxResult =
        await purchaseTaxService.calculatePurchaseTaxes(taxDocument);
      if (taxResult.error || !taxResult.data) {
        return {
          tax: null,
          error: taxResult.error ?? "Failed to calculate purchase taxes.",
        };
      }
      return { tax: taxResult.data, error: null };
    },
    [editingPurchase?.id, suppliers],
  );

  const saveDraft = useCallback(
    async (values: PurchaseFormValues) => {
      setIsSaving(true);
      setActionError(null);

      const resolved = await resolvePurchaseTax(values);
      if (resolved.error || !resolved.tax) {
        setActionError(resolved.error ?? "Failed to calculate purchase taxes.");
        setIsSaving(false);
        return false;
      }

      const tax = resolved.tax;
      const netLines = toNetPurchaseLines(values.lines, tax);
      if (netLines.error || !netLines.data) {
        setActionError(
          netLines.error ?? "Failed to convert inclusive prices to net unit cost.",
        );
        setIsSaving(false);
        return false;
      }

      const result = await purchaseService.saveDraft({
        ...values,
        id: editingPurchase?.id,
        lines: netLines.data,
        tax_total: tax.tax_total,
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
    [closeModal, editingPurchase?.id, loadPurchases, resolvePurchaseTax],
  );

  const receiveGoods = useCallback(
    async (values: PurchaseFormValues) => {
      setIsSaving(true);
      setActionError(null);
      setPostingError(null);

      const resolved = await resolvePurchaseTax(values);
      if (resolved.error || !resolved.tax) {
        setActionError(resolved.error ?? "Failed to calculate purchase taxes.");
        setIsSaving(false);
        return false;
      }

      const tax = resolved.tax;
      const netLines = toNetPurchaseLines(values.lines, tax);
      if (netLines.error || !netLines.data) {
        setActionError(
          netLines.error ?? "Failed to convert inclusive prices to net unit cost.",
        );
        setIsSaving(false);
        return false;
      }

      const receiveInput = {
        ...values,
        id: editingPurchase?.id,
        lines: netLines.data,
        tax_total: tax.tax_total,
      };

      const contextResult =
        await accountingContextService.getCurrentAccountingContext();

      if (contextResult.error || !contextResult.data) {
        // Accounting infra not ready (e.g. no open fiscal period) — the
        // purchase must still receive; only the journal is skipped,
        // surfaced via postingError rather than blocking the receive itself.
        const fallback = await purchaseService.receivePurchase(receiveInput);

        if (fallback.error || !fallback.data) {
          setActionError(fallback.error ?? "Failed to receive purchase");
          setIsSaving(false);
          return false;
        }

        setEditingPurchase(fallback.data);
        setAccountingPreview(mapPurchaseTotalsToAccountingPreview(fallback.data));
        setPostingError(
          contextResult.error ?? "Accounting posting was skipped.",
        );
        await loadPurchases({ silent: true });
        setIsSaving(false);
        return true;
      }

      const result = await purchaseService.receivePurchaseAndPostJournal(
        receiveInput,
        contextResult.data,
        tax,
      );

      if (result.error || !result.data) {
        setActionError(result.error ?? "Failed to receive purchase");
        setIsSaving(false);
        return false;
      }

      // Keep modal open so the owner can verify totals + the posted journal.
      setEditingPurchase(result.data.purchase);
      setAccountingPreview(
        result.data.posting
          ? mapPurchaseJournalPostingToPreview(result.data.posting)
          : mapPurchaseTotalsToAccountingPreview(result.data.purchase),
      );
      setPostingError(result.data.postingError);
      await loadPurchases({ silent: true });
      setIsSaving(false);
      return true;
    },
    [editingPurchase?.id, loadPurchases, resolvePurchaseTax],
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
    postingError,
    accountingPreview,
    openCreateModal,
    openPurchaseModal,
    closeModal,
    saveDraft,
    receiveGoods,
    retry: () => loadPurchases(),
  };
}
