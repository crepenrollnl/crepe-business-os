import Link from "next/link";
import type { ProductionPlanSessionHistoryItem } from "../types/production-session";
import { formatExecutionDateTime } from "../utils/format-execution-plan";
import {
  formatPlanSessionFactLabel,
  getPlanSessionDisplayDate,
} from "../utils/format-plan-session-history";
import {
  formatProductionSessionStatus,
  formatSessionQuantity,
  getProductionSessionStatusBadgeClass,
} from "../utils/format-production-session";

type ProductionExecutionPreviousRunsSectionProps = {
  sessions: ProductionPlanSessionHistoryItem[];
};

function formatProducedFacts(
  session: ProductionPlanSessionHistoryItem,
): string {
  const facts = session.lines
    .filter((line) => line.produced_quantity !== null)
    .map(
      (line) =>
        `${formatSessionQuantity(line.produced_quantity as number)} ${line.yield_unit} ${line.product_name}`,
    );

  return facts.length > 0 ? facts.join(", ") : "—";
}

export function ProductionExecutionPreviousRunsSection({
  sessions,
}: ProductionExecutionPreviousRunsSectionProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-4">
        <h2 className="text-base font-semibold text-zinc-900">Previous runs</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          {sessions.length === 0
            ? "No production sessions for this plan yet."
            : `${sessions.length} session${sessions.length === 1 ? "" : "s"} for this plan`}
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium text-zinc-900">No previous runs</p>
          <p className="mt-1 text-sm text-zinc-500">
            Start Production to record actual produced quantities for this plan.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-zinc-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Session
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Date
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Status
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Produced
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr
                  key={session.id}
                  className="border-t border-zinc-200 transition-colors hover:bg-zinc-50"
                >
                  <td className="px-4 py-4">
                    <Link
                      href={`/production-execution/sessions/${session.id}`}
                      className="text-sm font-medium text-zinc-900 underline-offset-2 hover:underline"
                    >
                      {formatPlanSessionFactLabel(session)}
                    </Link>
                  </td>
                  <td className="px-4 py-4 text-sm text-zinc-700">
                    {formatExecutionDateTime(getPlanSessionDisplayDate(session))}
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getProductionSessionStatusBadgeClass(
                        session.status,
                      )}`}
                    >
                      {formatProductionSessionStatus(session.status)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-sm text-zinc-700">
                    {formatProducedFacts(session)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
