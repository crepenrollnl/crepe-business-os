"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ProductionExecutionIngredientsSection } from "../components/production-execution-ingredients-section";
import { ProductionExecutionPlanHeader } from "../components/production-execution-plan-header";
import { ProductionExecutionProductsSection } from "../components/production-execution-products-section";
import { ProductionExecutionShoppingSummary } from "../components/production-execution-shopping-summary";
import { ProductionExecutionSummaryPlaceholder } from "../components/production-execution-summary-placeholder";
import { useProductionExecutionPlanDetail } from "../hooks/use-production-execution-plan-detail";

type ProductionExecutionPlanDetailPageProps = {
  planId: string;
};

export function ProductionExecutionPlanDetailPage({
  planId,
}: ProductionExecutionPlanDetailPageProps) {
  const {
    plan,
    loading,
    error,
    starting,
    startError,
    retry,
    startProduction,
  } = useProductionExecutionPlanDetail(planId);

  return (
    <DashboardLayout activePath="/production-execution">
      <div className="mx-auto max-w-7xl space-y-8">
        {loading ? (
          <div className="space-y-6">
            <div className="h-10 w-72 animate-pulse rounded-lg bg-zinc-100" />
            <div className="h-24 animate-pulse rounded-xl bg-zinc-100" />
            <div className="h-64 animate-pulse rounded-xl bg-zinc-100" />
          </div>
        ) : error || !plan ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <p className="text-base font-medium text-red-800">
              Failed to load production plan
            </p>
            <p className="mt-2 text-sm text-red-600">
              {error ?? "Production plan was not found."}
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-6 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <ProductionExecutionPlanHeader
              plan={plan}
              starting={starting}
              startError={startError}
              onStartProduction={() => {
                void startProduction();
              }}
            />
            <ProductionExecutionProductsSection products={plan.products} />
            <ProductionExecutionIngredientsSection
              ingredients={plan.ingredients}
            />
            <ProductionExecutionShoppingSummary
              items={plan.shopping_items}
              shoppingListStatus={plan.shopping_list_status}
            />
            <ProductionExecutionSummaryPlaceholder
              hasOpenSession={Boolean(plan.open_session)}
              hasCompletedSession={Boolean(plan.latest_completed_session)}
            />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
