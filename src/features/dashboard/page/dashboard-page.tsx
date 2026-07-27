"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ShiftStatusPanel } from "@/features/shifts/components/shift-status-panel";
import { BusinessHealthPanel } from "../components/business-health-panel";
import { DashboardDailySnapshotSection } from "../components/dashboard-daily-snapshot-section";
import { DashboardInfo } from "../components/dashboard-info";
import { DashboardKpiCards } from "../components/dashboard-kpi-cards";
import { DashboardLowStockAlertsSection } from "../components/dashboard-low-stock-alerts-section";
import { OperationalDashboardSection } from "../components/operational-dashboard-section";
import { useDashboard } from "../hooks/use-dashboard";

export function DashboardPage() {
  const {
    kpiCards,
    operationalDashboard,
    businessHealth,
    dailySnapshotFields,
    informationalMessages,
    lowStockAlerts,
    activeShift,
    closedShift,
    reconciliation,
    dailySalesSummary,
    dailyProfitSummary,
    loading,
    mutating,
    fatalError,
    shiftError,
    actionError,
    openShift,
    closeShift,
    reconcileCash,
    retry,
  } = useDashboard();

  const hasOverviewContent =
    Boolean(businessHealth) ||
    kpiCards.length > 0 ||
    dailySnapshotFields.length > 0 ||
    Boolean(operationalDashboard);

  return (
    <DashboardLayout activePath="/">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Today
          </h1>
          <p className="max-w-2xl text-base text-zinc-600 sm:text-lg">
            See how the business is doing, what needs attention, and where the
            day stands.
          </p>
        </header>

        {loading ? (
          <div
            className="rounded-2xl border border-zinc-200 bg-white p-10 text-center text-zinc-600 shadow-sm"
            role="status"
            aria-live="polite"
          >
            <p className="font-medium text-zinc-900">Loading today&apos;s overview…</p>
            <p className="mt-1 text-sm">This usually only takes a moment.</p>
          </div>
        ) : null}

        {!loading && fatalError ? (
          <div
            className="rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900 shadow-sm"
            role="alert"
            data-testid="dashboard-fatal-error"
          >
            <p className="text-lg font-semibold">We couldn&apos;t load today&apos;s overview</p>
            <p className="mt-1 text-sm text-red-800">{fatalError}</p>
            <button
              type="button"
              onClick={() => {
                void retry();
              }}
              className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
            >
              Try again
            </button>
          </div>
        ) : null}

        {!loading && !fatalError ? (
          <>
            {businessHealth ? (
              <BusinessHealthPanel model={businessHealth} />
            ) : null}

            <DashboardInfo messages={informationalMessages} />

            {!hasOverviewContent ? (
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/80 p-10 text-center">
                <p className="text-lg font-semibold text-zinc-900">
                  Nothing to show yet
                </p>
                <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600">
                  Open a shift to start the day, or check back once today&apos;s
                  numbers are ready.
                </p>
              </div>
            ) : null}

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <DashboardDailySnapshotSection fields={dailySnapshotFields} />
              {kpiCards.length > 0 ? (
                <DashboardKpiCards cards={kpiCards} />
              ) : null}
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <ShiftStatusPanel
                activeShift={activeShift}
                closedShift={closedShift}
                reconciliation={reconciliation}
                dailySalesSummary={dailySalesSummary}
                dailyProfitSummary={dailyProfitSummary}
                loading={loading}
                mutating={mutating}
                error={shiftError}
                actionError={actionError}
                onOpenShift={() => {
                  void openShift();
                }}
                onCloseShift={() => {
                  void closeShift();
                }}
                onReconcileCash={(countedCash) => {
                  void reconcileCash(countedCash);
                }}
                onRetry={() => {
                  void retry();
                }}
              />

              {operationalDashboard ? (
                <OperationalDashboardSection model={operationalDashboard} />
              ) : null}
            </div>

            <DashboardLowStockAlertsSection alerts={lowStockAlerts} />
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
