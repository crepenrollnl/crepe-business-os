"use client";

import { useCallback, useEffect, useState } from "react";
import { cashReconciliationService } from "@/features/shifts/services/cash-reconciliation-service";
import { dailyProfitSummaryService } from "@/features/shifts/services/daily-profit-summary-service";
import { dailySalesSummaryService } from "@/features/shifts/services/daily-sales-summary-service";
import { shiftService } from "@/features/shifts/services/shift-service";
import type { CashReconciliation } from "@/features/shifts/types/cash-reconciliation";
import type { DailyProfitSummary } from "@/features/shifts/types/daily-profit-summary";
import type { DailySalesSummary } from "@/features/shifts/types/daily-sales-summary";
import type { Shift } from "@/features/shifts/types/shift";
import type { LowStockAlert } from "@/features/inventory/types/low-stock-alert";
import { dashboardCompletionService } from "../services/dashboard-completion-service";
import { dashboardService } from "../services/dashboard-service";
import type { BusinessHealthModel } from "../types/business-health";
import type { DashboardKpiCard } from "../types/dashboard-kpi-cards";
import type { DashboardSnapshotField } from "../types/dashboard-completion";
import type { DashboardSummary } from "../types/dashboard";
import type { OperationalDashboardModel } from "../types/operational-dashboard";
import {
  classifyDashboardLoadFailure,
  createUnavailableModulesReadModel,
} from "../utils/dashboard-resilience";

/**
 * Dashboard UI orchestration (DEV-043 … DEV-126.1).
 *
 * Reads via dashboardService.getDashboardReadModel.
 * Module-owned failures stay isolated; global fatal only when the read model
 * itself cannot be composed for the page.
 */
export function useDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [kpiCards, setKpiCards] = useState<DashboardKpiCard[]>([]);
  const [operationalDashboard, setOperationalDashboard] =
    useState<OperationalDashboardModel | null>(null);
  const [businessHealth, setBusinessHealth] =
    useState<BusinessHealthModel | null>(null);
  const [dailySnapshotFields, setDailySnapshotFields] = useState<
    DashboardSnapshotField[]
  >([]);
  const [informationalMessages, setInformationalMessages] = useState<string[]>(
    [],
  );
  const [activeShift, setActiveShift] = useState<Shift | null>(null);
  const [closedShift, setClosedShift] = useState<Shift | null>(null);
  const [reconciliation, setReconciliation] =
    useState<CashReconciliation | null>(null);
  const [dailySalesSummary, setDailySalesSummary] =
    useState<DailySalesSummary | null>(null);
  const [dailyProfitSummary, setDailyProfitSummary] =
    useState<DailyProfitSummary | null>(null);
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
    setKpiCards([]);
    setOperationalDashboard(null);
    setBusinessHealth(null);
    setDailySnapshotFields([]);
    setInformationalMessages([]);
    setActiveShift(null);
    setClosedShift(null);
    setReconciliation(null);
    setDailySalesSummary(null);
    setDailyProfitSummary(null);
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
        setDailySalesSummary(model.daily_sales_summary);
        setDailyProfitSummary(model.daily_profit_summary);
        setLowStockAlerts(model.low_stock_alerts);
        setSummary(model.kpi_summary);
        return;
      }

      const completion = completionResult.data;
      setSummary(completion.read_model.kpi_summary);
      setActiveShift(completion.read_model.current_shift);
      setClosedShift(completion.read_model.latest_closed_shift);
      setReconciliation(completion.read_model.cash_reconciliation);
      setDailySalesSummary(completion.read_model.daily_sales_summary);
      setDailyProfitSummary(completion.read_model.daily_profit_summary);
      setLowStockAlerts(completion.low_stock_alerts);
      setKpiCards(completion.kpi_cards);
      setOperationalDashboard(completion.operational);
      setBusinessHealth(completion.business_health);
      setDailySnapshotFields(completion.daily_snapshot.fields);
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

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

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
    kpiCards,
    operationalDashboard,
    businessHealth,
    dailySnapshotFields,
    informationalMessages,
    activeShift,
    closedShift,
    reconciliation,
    dailySalesSummary,
    dailyProfitSummary,
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
