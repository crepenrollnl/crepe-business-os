import Link from "next/link";
import type { ProductionPlanWithRelations } from "../types/production";
import {
  formatProductionPlanDate,
  formatProductionPlanStatus,
  getProductionPlanStatusBadgeClass,
} from "../utils/format-production-plan";

type ProductionPlanDetailHeaderProps = {
  plan: ProductionPlanWithRelations;
  canCalculate: boolean;
  isCalculating: boolean;
  onCalculate: () => void;
};

export function ProductionPlanDetailHeader({
  plan,
  canCalculate,
  isCalculating,
  onCalculate,
}: ProductionPlanDetailHeaderProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              {plan.name}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getProductionPlanStatusBadgeClass(
                plan.status,
              )}`}
            >
              {formatProductionPlanStatus(plan.status)}
            </span>
          </div>

          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600">
            <div>
              <dt className="inline font-medium text-zinc-500">Plan #</dt>{" "}
              <dd className="inline text-zinc-800">{plan.plan_number}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-zinc-500">Planned Date</dt>{" "}
              <dd className="inline text-zinc-800">
                {formatProductionPlanDate(plan.planning_date)}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-zinc-500">Products</dt>{" "}
              <dd className="inline text-zinc-800">
                {plan.summary.planned_product_count}
              </dd>
            </div>
          </dl>

          {plan.notes ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                Notes
              </p>
              <p className="mt-1 max-w-3xl text-sm text-zinc-700">{plan.notes}</p>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Link
            href="/production-planning"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
          >
            Back to Plans
          </Link>
          <button
            type="button"
            disabled={!canCalculate || isCalculating}
            onClick={onCalculate}
            title={
              canCalculate
                ? "Calculate ingredient requirements for this plan"
                : "Add at least one product before calculating requirements"
            }
            className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCalculating ? "Calculating..." : "Calculate Requirements"}
          </button>
        </div>
      </div>
    </div>
  );
}
