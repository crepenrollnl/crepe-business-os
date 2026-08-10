"use client";

import { useCallback, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { cashReconciliationService } from "../services/cash-reconciliation-service";
import { dailyProfitSummaryService } from "../services/daily-profit-summary-service";
import { dailySalesSummaryService } from "../services/daily-sales-summary-service";
import { shiftService } from "../services/shift-service";
import type { CashReconciliation } from "../types/cash-reconciliation";
import type { DailyProfitSummary } from "../types/daily-profit-summary";
import type { DailySalesSummary } from "../types/daily-sales-summary";
import type { Shift } from "../types/shift";

/**
 * Shift + cash + daily sales/profit summary orchestration
 * (DEV-112 / DEV-113 / DEV-114 / DEV-115 / DEV-116).
 *
 * Close-day review loads immutable stored summaries only.
 * Missing summaries stay informational — never regenerated in the UI.
 */
export function useShift() {
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [closedShift, setClosedShift] = useState<Shift | null>(null);
  const [reconciliation, setReconciliation] =
    useState<CashReconciliation | null>(null);
  const [dailySalesSummary, setDailySalesSummary] =
    useState<DailySalesSummary | null>(null);
  const [dailyProfitSummary, setDailyProfitSummary] =
    useState<DailyProfitSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const clearClosedExtras = useCallback(() => {
    setReconciliation(null);
    setDailySalesSummary(null);
    setDailyProfitSummary(null);
  }, []);

  const loadReconciliationForShift = useCallback(async (shift: Shift) => {
    const result =
      await cashReconciliationService.getReconciliationForShift(shift.id);

    if (result.error) {
      setReconciliation(null);
      return result.error;
    }

    // Display stored reconciliation only — never invent expected cash in the UI.
    setReconciliation(result.data);
    return null;
  }, []);

  const loadDailySalesSummaryForShift = useCallback(async (shift: Shift) => {
    const result = await dailySalesSummaryService.getSummaryForShift(shift.id);

    if (result.error) {
      setDailySalesSummary(null);
      return result.error;
    }

    setDailySalesSummary(result.data);
    return null;
  }, []);

  const loadDailyProfitSummaryForShift = useCallback(async (shift: Shift) => {
    const result = await dailyProfitSummaryService.getSummaryForShift(shift.id);

    if (result.error) {
      setDailyProfitSummary(null);
      return result.error;
    }

    setDailyProfitSummary(result.data);
    return null;
  }, []);

  const loadClosedShiftExtras = useCallback(
    async (shift: Shift) => {
      const salesError = await loadDailySalesSummaryForShift(shift);
      if (salesError) {
        return salesError;
      }

      const profitError = await loadDailyProfitSummaryForShift(shift);
      if (profitError) {
        return profitError;
      }

      const reconciliationError = await loadReconciliationForShift(shift);
      if (reconciliationError) {
        return reconciliationError;
      }

      return null;
    },
    [
      loadDailyProfitSummaryForShift,
      loadDailySalesSummaryForShift,
      loadReconciliationForShift,
    ],
  );

  const loadShiftState = useCallback(async () => {
    setLoading(true);
    setError(null);

    const activeResult = await shiftService.getActiveShift();
    if (activeResult.error) {
      setActiveShift(null);
      setClosedShift(null);
      clearClosedExtras();
      setError(activeResult.error);
      setLoading(false);
      return;
    }

    if (activeResult.data) {
      setActiveShift(activeResult.data);
      setClosedShift(null);
      clearClosedExtras();
      setError(null);
      setLoading(false);
      return;
    }

    setActiveShift(null);

    const closedResult = await shiftService.getLatestClosedShift();
    if (closedResult.error) {
      setClosedShift(null);
      clearClosedExtras();
      setError(closedResult.error);
      setLoading(false);
      return;
    }

    const latestClosed = closedResult.data;
    setClosedShift(latestClosed);

    if (!latestClosed) {
      clearClosedExtras();
      setError(null);
      setLoading(false);
      return;
    }

    const extrasError = await loadClosedShiftExtras(latestClosed);
    if (extrasError) {
      setError(extrasError);
      setLoading(false);
      return;
    }

    setError(null);
    setLoading(false);
  }, [clearClosedExtras, loadClosedShiftExtras]);

  useAsyncEffect(loadShiftState, [loadShiftState]);

  const openShift = useCallback(async () => {
    setMutating(true);
    setActionError(null);

    const result = await shiftService.openShift({});

    if (result.error || !result.data) {
      setActionError(result.error ?? "Failed to open shift");
      setMutating(false);
      return false;
    }

    setActiveShift(result.data.shift);
    setClosedShift(null);
    clearClosedExtras();
    setMutating(false);
    return true;
  }, [clearClosedExtras]);

  const closeShift = useCallback(async () => {
    if (!activeShift) {
      setActionError("No active shift to close.");
      return false;
    }

    setMutating(true);
    setActionError(null);

    const result = await shiftService.closeShift({
      shift_id: activeShift.id,
    });

    if (result.error || !result.data) {
      setActionError(result.error ?? "Failed to close shift");
      setMutating(false);
      return false;
    }

    const closed = result.data.shift;
    setActiveShift(null);
    setClosedShift(closed);

    const salesResult =
      await dailySalesSummaryService.generateForClosedShift(closed);

    if (salesResult.error || !salesResult.data) {
      setDailySalesSummary(null);
      setDailyProfitSummary(null);
      setActionError(
        salesResult.error ?? "Failed to generate daily sales summary",
      );
      setMutating(false);
      return true;
    }

    setDailySalesSummary(salesResult.data.summary);

    const profitResult =
      await dailyProfitSummaryService.generateForClosedShift(closed);

    if (profitResult.error || !profitResult.data) {
      setDailyProfitSummary(null);
      setActionError(
        profitResult.error ?? "Failed to generate daily profit summary",
      );
      setMutating(false);
      return true;
    }

    setDailyProfitSummary(profitResult.data.summary);

    const reconciliationError = await loadReconciliationForShift(closed);
    if (reconciliationError) {
      setActionError(reconciliationError);
    }

    setMutating(false);
    return true;
  }, [activeShift, loadReconciliationForShift]);

  const reconcileCash = useCallback(
    async (countedCash: number) => {
      if (!closedShift) {
        setActionError("Close the shift before reconciling cash.");
        return false;
      }

      setMutating(true);
      setActionError(null);

      const result = await cashReconciliationService.reconcileShiftCash({
        shift_id: closedShift.id,
        counted_cash: countedCash,
      });

      if (result.error || !result.data) {
        setActionError(result.error ?? "Failed to reconcile cash");
        setMutating(false);
        return false;
      }

      setReconciliation(result.data.reconciliation);
      setMutating(false);
      return true;
    },
    [closedShift],
  );

  return {
    activeShift,
    closedShift,
    reconciliation,
    dailySalesSummary,
    dailyProfitSummary,
    loading,
    mutating,
    error,
    actionError,
    openShift,
    closeShift,
    reconcileCash,
    retry: loadShiftState,
  };
}
