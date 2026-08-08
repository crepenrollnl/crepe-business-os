"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ShiftStatusPanel } from "@/components/shift-status-panel";
import { DashboardInfo } from "../components/dashboard-info";
import { DashboardLowStockAlertsSection } from "../components/dashboard-low-stock-alerts-section";
import { DashboardMoneyTodaySection } from "../components/dashboard-money-today-section";
import { useDashboard } from "../hooks/use-dashboard";

export function DashboardPage() {
  const {
    moneyToday,
    informationalMessages,
    lowStockAlerts,
    activeShift,
    closedShift,
    reconciliation,
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
            <DashboardInfo messages={informationalMessages} />

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <ShiftStatusPanel
                activeShift={activeShift}
                closedShift={closedShift}
                reconciliation={reconciliation}
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

              {moneyToday ? (
                <DashboardMoneyTodaySection model={moneyToday} />
              ) : null}
            </div>

            <DashboardLowStockAlertsSection alerts={lowStockAlerts} />
          </>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
