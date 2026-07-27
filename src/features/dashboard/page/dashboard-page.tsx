"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ShiftStatusPanel } from "@/features/shifts/components/shift-status-panel";
import { useShift } from "@/features/shifts/hooks/use-shift";
import { DashboardKpiCards } from "../components/dashboard-kpi-cards";
import { useDashboard } from "../hooks/use-dashboard";

export function DashboardPage() {
  const { summary, loading, error, retry } = useDashboard();
  const {
    activeShift,
    closedShift,
    reconciliation,
    dailySalesSummary,
    dailyProfitSummary,
    loading: shiftLoading,
    mutating: shiftMutating,
    error: shiftError,
    actionError: shiftActionError,
    openShift,
    closeShift,
    reconcileCash,
    retry: retryShift,
  } = useShift();

  return (
    <DashboardLayout activePath="/">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Dashboard
          </h2>
          <p className="mt-2 text-base text-zinc-600 sm:text-lg">
            Operational overview from the dashboard summary.
          </p>
        </div>

        <div className="mb-8">
          <ShiftStatusPanel
            activeShift={activeShift}
            closedShift={closedShift}
            reconciliation={reconciliation}
            dailySalesSummary={dailySalesSummary}
            dailyProfitSummary={dailyProfitSummary}
            loading={shiftLoading}
            mutating={shiftMutating}
            error={shiftError}
            actionError={shiftActionError}
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
              void retryShift();
            }}
          />
        </div>

        {loading ? (
          <div
            className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-zinc-600 shadow-sm"
            role="status"
            aria-live="polite"
          >
            Loading dashboard…
          </div>
        ) : null}

        {!loading && error ? (
          <div
            className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800 shadow-sm"
            role="alert"
          >
            <p className="font-medium">Could not load dashboard</p>
            <p className="mt-1 text-sm">{error}</p>
            <button
              type="button"
              onClick={() => {
                void retry();
              }}
              className="mt-4 rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800"
            >
              Retry
            </button>
          </div>
        ) : null}

        {!loading && !error && !summary ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-zinc-600 shadow-sm">
            <p className="font-medium text-zinc-900">No dashboard data yet</p>
            <p className="mt-1 text-sm">
              Summary metrics will appear once operational data is available.
            </p>
          </div>
        ) : null}

        {!loading && !error && summary ? (
          <DashboardKpiCards summary={summary} />
        ) : null}
      </div>
    </DashboardLayout>
  );
}
