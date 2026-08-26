"use client";

import Link from "next/link";
import type { ProductionSessionWithRelations } from "../types/production-session";
import { formatExecutionDateTime } from "../utils/format-execution-plan";
import {
  formatProductionSessionStatus,
  getProductionSessionStatusBadgeClass,
} from "../utils/format-production-session";

type ProductionSessionHeaderProps = {
  session: ProductionSessionWithRelations;
  notes: string;
  canEdit: boolean;
  canFinish: boolean;
  finishing: boolean;
  saving: boolean;
  actionError: string | null;
  zeroCostWarning?: string | null;
  onNotesChange: (value: string) => void;
  onSaveProgress: () => void;
  onFinish: () => void;
};

export function ProductionSessionHeader({
  session,
  notes,
  canEdit,
  canFinish,
  finishing,
  saving,
  actionError,
  zeroCostWarning = null,
  onNotesChange,
  onSaveProgress,
  onFinish,
}: ProductionSessionHeaderProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              Production Session #{session.session_number}
            </h1>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getProductionSessionStatusBadgeClass(
                session.status,
              )}`}
            >
              {formatProductionSessionStatus(session.status)}
            </span>
          </div>

          <p className="text-base text-zinc-600">
            Plan:{" "}
            <Link
              href={`/production-execution/${session.plan.id}`}
              className="font-medium text-zinc-900 underline-offset-2 hover:underline"
            >
              {session.plan.name}
            </Link>{" "}
            <span className="text-zinc-400">#{session.plan.plan_number}</span>
          </p>

          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600">
            <div>
              <dt className="inline font-medium text-zinc-500">Session Status</dt>{" "}
              <dd className="inline text-zinc-800">
                {formatProductionSessionStatus(session.status)}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-zinc-500">Started At</dt>{" "}
              <dd className="inline text-zinc-800">
                {formatExecutionDateTime(session.started_at)}
              </dd>
            </div>
            <div>
              <dt className="inline font-medium text-zinc-500">Operator</dt>{" "}
              <dd className="inline text-zinc-800">
                {session.operator_name?.trim() ? session.operator_name : "—"}
              </dd>
            </div>
            {session.completed_at ? (
              <div>
                <dt className="inline font-medium text-zinc-500">Completed At</dt>{" "}
                <dd className="inline text-zinc-800">
                  {formatExecutionDateTime(session.completed_at)}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Link
              href={`/production-execution/${session.plan.id}`}
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50"
            >
              Back to Plan
            </Link>

            {canEdit ? (
              <>
                <button
                  type="button"
                  onClick={onSaveProgress}
                  disabled={saving || finishing}
                  className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-5 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Progress"}
                </button>
                <button
                  type="button"
                  onClick={onFinish}
                  disabled={!canFinish || finishing || saving}
                  title={
                    canFinish
                      ? undefined
                      : "Enter an actual produced quantity for every product"
                  }
                  className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {finishing ? "Finishing..." : "Finish Production"}
                </button>
              </>
            ) : null}
          </div>

          {actionError ? (
            <p className="max-w-sm text-right text-sm text-red-600">
              {actionError}
            </p>
          ) : null}
        </div>
      </div>

      {zeroCostWarning ? (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {zeroCostWarning}
        </div>
      ) : null}

      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
        <label
          htmlFor="production-session-notes"
          className="block text-xs font-medium uppercase tracking-wide text-zinc-500"
        >
          Notes
        </label>
        {canEdit ? (
          <textarea
            id="production-session-notes"
            value={notes}
            onChange={(event) => onNotesChange(event.target.value)}
            rows={3}
            placeholder="Optional notes about this production run"
            className="mt-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
          />
        ) : (
          <p className="mt-2 text-sm text-zinc-700">
            {session.notes?.trim() ? session.notes : "No notes recorded."}
          </p>
        )}
      </div>
    </div>
  );
}
