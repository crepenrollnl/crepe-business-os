"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ProductionExecutionQueueTable } from "../components/production-execution-queue-table";
import { useProductionExecution } from "../hooks/use-production-execution";

export function ProductionExecutionPage() {
  const {
    items,
    loading,
    error,
    sortField,
    sortDirection,
    isRefreshing,
    toggleSort,
    refresh,
    openPlan,
    retry,
  } = useProductionExecution();

  return (
    <DashboardLayout activePath="/production-execution">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              Production Execution
            </h1>
            <p className="mt-2 text-base text-zinc-600 sm:text-lg">
              Execute production plans and convert raw materials into finished
              goods.
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void refresh();
              }}
              disabled={loading || isRefreshing}
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <ProductionExecutionQueueTable
          items={items}
          loading={loading}
          error={error}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={toggleSort}
          onRetry={retry}
          onOpen={openPlan}
        />
      </div>
    </DashboardLayout>
  );
}
