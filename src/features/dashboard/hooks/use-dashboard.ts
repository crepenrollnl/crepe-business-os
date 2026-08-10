"use client";

import { useCallback, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { cashReconciliationService } from "@/features/shifts/services/cash-reconciliation-service";
import { dailyProfitSummaryService } from "@/features/shifts/services/daily-profit-summary-service";
import { dailySalesSummaryService } from "@/features/shifts/services/daily-sales-summary-service";
import { shiftService } from "@/features/shifts/services/shift-service";
import type { CashReconciliation } from "@/features/shifts/types/cash-reconciliation";
import type { Shift } from "@/features/shifts/types/shift";
import type { LowStockAlert } from "@/features/inventory/types/low-stock-alert";
import { dashboardCompletionService } from "../services/dashboard-completion-service";
import { dashboardService } from "../services/dashboard-service";
import type { MoneyTodayModel } from "../types/dashboard-completion";
import type { DashboardSummary } from "../types/dashboard";
import {
  classifyDashboardLoadFailure,
  createUnavailableModulesReadModel,
} from "../utils/dashboard-resilience";

/**
 * Dashboard UI orchestration (DEV-043 … Dashboard redesign 3-block).
 *
 * Reads via dashboardService.getDashboardReadModel.
 * Module-owned failures stay isolated; global fatal only when the read model
 * itself cannot be composed for the page.
 */
export function useDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [moneyToday, setMoneyToday] = useState<MoneyTodayModel | null>(null);
  const [informationalMessages, setInformationalMessages] = useState<string[]>(
    [],
  );
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [closedShift, setClosedShift] = useState<Shift | null>(null);
  const [reconciliation, setReconciliation] =
    useState<CashReconciliation | null>(null);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[] | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  /** Fatal only when the Dashboard Read Model itself cannot be loaded. */
  const [fatalError, setFatalError] = useState<string | null>(null);
  /** Shift-owned load/action problems — never shown as a global dashboard error. */
  const [shiftError, setShiftError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const clearDashboardState = useCallback(() => {
    setSummary(null);
    setMoneyToday(null);
    setInformationalMessages([]);
    setActiveShift(null);
    setClosedShift(null);
    setReconciliation(null);
    setLowStockAlerts(null);
  }, []);

  const applyReadModel = useCallback(
    (
      model: NonNullable<
        Awaited<
          ReturnType<typeof dashboardService.getDashboardReadModel>
        >["data"]
      >,
    ) => {
      const completionResult =
        dashboardCompletionService.buildFromReadModel(model);

      if (completionResult.error || !completionResult.data) {
        // Composition failed — still keep shift facts for the Shift panel.
        clearDashboardState();
        setActiveShift(model.current_shift);
        setClosedShift(model.latest_closed_shift);
        setReconciliation(model.cash_reconciliation);
        setLowStockAlerts(model.low_stock_alerts);
        setSummary(model.kpi_summary);
        return;
      }

      const completion = completionResult.data;
      setSummary(completion.read_model.kpi_summary);
      setActiveShift(completion.read_model.current_shift);
      setClosedShift(completion.read_model.latest_closed_shift);
      setReconciliation(completion.read_model.cash_reconciliation);
      setLowStockAlerts(completion.low_stock_alerts);
      setMoneyToday(completion.money_today);
      setInformationalMessages(completion.informational_messages);
    },
    [clearDashboardState],
  );

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setFatalError(null);
    setShiftError(null);

    const result = await dashboardService.getDashboardReadModel();

    if (result.error || !result.data) {
      const classified = classifyDashboardLoadFailure(
        result.error ?? "Failed to load dashboard",
      );

      if (classified.owner === "dashboard") {
        clearDashboardState();
        setFatalError(classified.userMessage);
        setLoading(false);
        return;
      }

      // Module-owned failure: keep the Dashboard usable with an empty shell.
      if (classified.owner === "shift") {
        setShiftError(classified.userMessage);
      }

      applyReadModel(createUnavailableModulesReadModel());
      setFatalError(null);
      setLoading(false);
      return;
    }

    applyReadModel(result.data);
    setFatalError(null);
    setShiftError(null);
    setLoading(false);
  }, [applyReadModel, clearDashboardState]);

  useAsyncEffect(loadDashboard, [loadDashboard]);

  const openShift = useCallback(async () => {
    setMutating(true);
    setActionError(null);

    const result = await shiftService.openShift({});

    if (result.error || !result.data) {
      setActionError(result.error ?? "Failed to open shift");
      setMutating(false);
      return false;
    }

    await loadDashboard();
    setMutating(false);
    return true;
  }, [loadDashboard]);

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

    const salesResult =
      await dailySalesSummaryService.generateForClosedShift(closed);

    if (salesResult.error || !salesResult.data) {
      setActionError(
        salesResult.error ?? "Failed to generate daily sales summary",
      );
      await loadDashboard();
      setMutating(false);
      return true;
    }

    const profitResult =
      await dailyProfitSummaryService.generateForClosedShift(closed);

    if (profitResult.error || !profitResult.data) {
      setActionError(
        profitResult.error ?? "Failed to generate daily profit summary",
      );
      await loadDashboard();
      setMutating(false);
      return true;
    }

    await loadDashboard();
    setMutating(false);
    return true;
  }, [activeShift, loadDashboard]);

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

      await loadDashboard();
      setMutating(false);
      return true;
    },
    [closedShift, loadDashboard],
  );

  return {
    summary,
    moneyToday,
    informationalMessages,
    activeShift,
    closedShift,
    reconciliation,
    lowStockAlerts,
    loading,
    mutating,
    fatalError,
    shiftError,
    actionError,
    openShift,
    closeShift,
    reconcileCash,
    retry: loadDashboard,
  };
}
