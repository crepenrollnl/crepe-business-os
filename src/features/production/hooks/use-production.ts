"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { productionService } from "../services/production-service";
import type {
  ProductionPlanFormValues,
  ProductionPlanListItem,
  ProductionPlanStatus,
  ProductionSortDirection,
  ProductionSortField,
} from "../types/production";

const HIGHLIGHT_DURATION_MS = 2500;

function comparePlans(
  a: ProductionPlanListItem,
  b: ProductionPlanListItem,
  sortField: ProductionSortField,
  sortDirection: ProductionSortDirection,
): number {
  const direction = sortDirection === "asc" ? 1 : -1;

  if (sortField === "plan_number") {
    return (a.plan_number - b.plan_number) * direction;
  }

  if (sortField === "name") {
    return a.name.localeCompare(b.name) * direction;
  }

  if (sortField === "status") {
    return a.status.localeCompare(b.status) * direction;
  }

  if (sortField === "created_at") {
    return (
      (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
      direction
    );
  }

  if (sortField === "updated_at") {
    const aUpdated = a.updated_at ?? a.created_at;
    const bUpdated = b.updated_at ?? b.created_at;
    return (
      (new Date(aUpdated).getTime() - new Date(bUpdated).getTime()) *
      direction
    );
  }

  return (
    (new Date(a.planning_date).getTime() -
      new Date(b.planning_date).getTime()) *
    direction
  );
}

async function fetchProductionState() {
  const plansResult = await productionService.getProductionPlans();

  return {
    items: plansResult.error ? [] : (plansResult.data ?? []),
    error: plansResult.error ?? null,
  };
}

function emptyFormValues(): ProductionPlanFormValues {
  return {
    name: "",
    planning_date: new Date().toISOString().slice(0, 10),
    notes: "",
  };
}

export function useProduction() {
  const router = useRouter();
  const [items, setItems] = useState<ProductionPlanListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProductionPlanStatus | "">(
    "",
  );
  const [sortField, setSortField] =
    useState<ProductionSortField>("planning_date");
  const [sortDirection, setSortDirection] =
    useState<ProductionSortDirection>("desc");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [highlightedPlanId, setHighlightedPlanId] = useState<string | null>(
    null,
  );

  const applyState = useCallback(
    (state: Awaited<ReturnType<typeof fetchProductionState>>) => {
      setItems(state.items);
      setError(state.error);
    },
    [],
  );

  const loadProduction = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
      }

      const state = await fetchProductionState();
      applyState(state);
      setLoading(false);
    },
    [applyState],
  );

  useEffect(() => {
    void (async () => {
      const state = await fetchProductionState();
      applyState(state);
      setLoading(false);
    })();
  }, [applyState]);

  useEffect(() => {
    if (!highlightedPlanId) {
      return;
    }

    const timer = window.setTimeout(() => {
      setHighlightedPlanId(null);
    }, HIGHLIGHT_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [highlightedPlanId]);

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

      const nameMatch = item.name.toLowerCase().includes(normalizedSearch);
      const numberMatch = String(item.plan_number).includes(normalizedSearch);
      const notesMatch = (item.notes ?? "")
        .toLowerCase()
        .includes(normalizedSearch);
      const statusMatch = item.status
        .replaceAll("_", " ")
        .toLowerCase()
        .includes(normalizedSearch);

      return nameMatch || numberMatch || notesMatch || statusMatch;
    });

    return [...filtered].sort((a, b) =>
      comparePlans(a, b, sortField, sortDirection),
    );
  }, [items, search, statusFilter, sortField, sortDirection]);

  const hasActiveFilters =
    search.trim().length > 0 || statusFilter.length > 0;

  const toggleSort = useCallback(
    (field: ProductionSortField) => {
      if (field === sortField) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
        return;
      }

      setSortField(field);
      setSortDirection(
        field === "planning_date" ||
          field === "created_at" ||
          field === "updated_at"
          ? "desc"
          : "asc",
      );
    },
    [sortField],
  );

  const openCreateModal = useCallback(() => {
    setActionError(null);
    setIsModalOpen(true);
  }, []);

  const openPlan = useCallback(
    (item: ProductionPlanListItem) => {
      router.push(`/production-planning/${item.id}`);
    },
    [router],
  );

  const closeModal = useCallback(() => {
    if (isSaving) {
      return;
    }

    setIsModalOpen(false);
    setActionError(null);
  }, [isSaving]);

  const savePlan = useCallback(
    async (values: ProductionPlanFormValues) => {
      setIsSaving(true);
      setActionError(null);

      const result = await productionService.createProductionPlan(values);

      if (result.error || !result.data) {
        setActionError(result.error ?? "Failed to create production plan");
        setIsSaving(false);
        return false;
      }

      setIsModalOpen(false);
      setIsSaving(false);
      router.push(`/production-planning/${result.data.id}`);
      return true;
    },
    [router],
  );

  return {
    items: filteredItems,
    totalCount: items.length,
    hasActiveFilters,
    loading,
    error,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    sortField,
    sortDirection,
    toggleSort,
    isModalOpen,
    initialFormValues: emptyFormValues(),
    isSaving,
    actionError,
    highlightedPlanId,
    openCreateModal,
    openPlan,
    closeModal,
    savePlan,
    retry: () => loadProduction(),
  };
}
