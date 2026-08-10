"use client";

import Link from "next/link";
import type { ProductionExecutionPlanDetail } from "../types/production-execution";
import {
  formatExecutablePlanStatus,
  formatExecutionDate,
  getExecutablePlanStatusBadgeClass,
} from "../utils/format-execution-plan";

type ProductionExecutionPlanHeaderProps = {
  plan: ProductionExecutionPlanDetail;
  starting: boolean;
  startError: string | null;
  onStartProduction: () => void;
};

export function ProductionExecutionPlanHeader({
  plan,
  starting,
  startError,
  onStartProduction,
}: ProductionExecutionPlanHeaderProps) {
  const openSession = plan.open_session;
  const completedSession = plan.latest_completed_session;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              {plan.name}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getExecutablePlanStatusBadgeClass(
                plan.status,
              )}`}
            >
              {formatExecutablePlanStatus(plan.status)}
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
                {formatExecutionDate(plan.planning_date)}
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

        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Link
              href="/production-execution"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
            >
              Back to Queue
            </Link>

            {openSession ? (
              <Link
                href={`/production-execution/sessions/${openSession.id}`}
                className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
              >
                Continue Session #{openSession.session_number}
              </Link>
            ) : (
              <button
                type="button"
                onClick={onStartProduction}
                disabled={starting || plan.products.length === 0}
                title={
                  plan.products.length === 0
                    ? "Add products to the plan before starting production"
                    : undefined
                }
                className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {starting ? "Starting..." : "Start Production"}
              </button>
            )}
          </div>

          {!openSession && completedSession ? (
            <Link
              href={`/production-execution/sessions/${completedSession.id}`}
              className="text-sm font-medium text-zinc-600 underline-offset-2 hover:text-zinc-900 hover:underline"
            >
              Reopen Session #{completedSession.session_number}
            </Link>
          ) : null}

          {startError ? (
            <p className="max-w-sm text-right text-sm text-red-600">
              {startError}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
