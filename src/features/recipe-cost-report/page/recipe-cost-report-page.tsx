"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { RecipeCostDetailModal } from "../components/recipe-cost-detail-modal";
import { RecipeCostReportTable } from "../components/recipe-cost-report-table";
import { useRecipeCostReport } from "../hooks/use-recipe-cost-report";

export function RecipeCostReportPage() {
  const {
    rows,
    loading,
    error,
    retry,
    selectedRow,
    detail,
    detailLoading,
    detailError,
    openDetail,
    closeDetail,
  } = useRecipeCostReport();

  return (
    <DashboardLayout activePath="/recipes/cost-report">
      <div className="mx-auto max-w-7xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Recipe Cost
          </h1>
          <p className="mt-2 text-base text-zinc-600 sm:text-lg">
            Cost of sellable products and semi-finished recipes. Owner and
            partner only.
          </p>
        </div>

        <RecipeCostReportTable
          rows={rows}
          loading={loading}
          error={error}
          onRetry={() => {
            void retry();
          }}
          onOpenDetail={(row) => {
            void openDetail(row);
          }}
        />

        <RecipeCostDetailModal
          isOpen={selectedRow !== null}
          recipeName={selectedRow?.recipe_name ?? null}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          onClose={closeDetail}
        />
      </div>
    </DashboardLayout>
  );
}
