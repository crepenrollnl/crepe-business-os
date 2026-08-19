"use client";

import { useCallback, useState } from "react";
import { cashReconciliationService } from "@/features/shifts/services/cash-reconciliation-service";
import { dailyProfitSummaryService } from "@/features/shifts/services/daily-profit-summary-service";
import { dailySalesSummaryService } from "@/features/shifts/services/daily-sales-summary-service";
import { shiftService } from "@/features/shifts/services/shift-service";
import type { CashReconciliation } from "@/features/shifts/types/cash-reconciliation";
import type { Shift } from "@/features/shifts/types/shift";
import { useAsyncEffect } from "@/hooks/use-async-effect";

export function usePosShift() {
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [closedShift, setClosedShift] = useState<Shift | null>(null);
  const [reconciliation, setReconciliation] =
    useState<CashReconciliation | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadReconciliationForShift = useCallback(async (shift: Shift) => {
    const result = await cashReconciliationService.getReconciliationForShift(
      shift.id,
    );

    if (result.error) {
      setReconciliation(null);
      return result.error;
    }

    setReconciliation(result.data);
    return null;
  }, []);

  const loadShiftState = useCallback(async () => {
    setLoading(true);
    setError(null);

    const activeResult = await shiftService.getActiveShift();
    if (activeResult.error) {
      setActiveShift(null);
      setClosedShift(null);
      setReconciliation(null);
      setError(activeResult.error);
      setLoading(false);
      return;
    }

    if (activeResult.data) {
      setActiveShift(activeResult.data);
      setClosedShift(null);
      setReconciliation(null);
      setError(null);
      setLoading(false);
      return;
    }

    setActiveShift(null);

    const closedResult = await shiftService.getLatestClosedShift();
    if (closedResult.error) {
      setClosedShift(null);
      setReconciliation(null);
      setError(closedResult.error);
      setLoading(false);
      return;
    }

    const latestClosed = closedResult.data;
    setClosedShift(latestClosed);

    if (!latestClosed) {
      setReconciliation(null);
      setError(null);
      setLoading(false);
      return;
    }

    const reconciliationError = await loadReconciliationForShift(latestClosed);
    if (reconciliationError) {
      setError(reconciliationError);
      setLoading(false);
      return;
    }

    setError(null);
    setLoading(false);
  }, [loadReconciliationForShift]);

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
    setReconciliation(null);
    setMutating(false);
    return true;
  }, []);

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
      setActionError(
        salesResult.error ?? "Failed to generate daily sales summary",
      );
      setMutating(false);
      return true;
    }

    const profitResult =
      await dailyProfitSummaryService.generateForClosedShift(closed);

    if (profitResult.error || !profitResult.data) {
      setActionError(
        profitResult.error ?? "Failed to generate daily profit summary",
      );
      setMutating(false);
      return true;
    }

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
    /** Active shift while open; latest closed shift after Close — History uses this window. */
    historyShift: activeShift ?? closedShift,
    reconciliation,
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
