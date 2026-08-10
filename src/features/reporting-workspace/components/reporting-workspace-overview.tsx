import { formatDateTime } from "@/lib/date";
import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";

type ReportingWorkspaceOverviewProps = {
  overview: ReportingOverview | null;
};

/**
 * Presentational reporting overview section catalog.
 * Nested dashboard payloads are not recalculated in the UI.
 */
export function ReportingWorkspaceOverview({
  overview,
}: ReportingWorkspaceOverviewProps) {
  if (!overview) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-zinc-900">
          Reporting overview
        </h3>
        <p className="mt-2 text-sm text-zinc-600">
          No reporting overview is available yet.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-6 py-4">
        <h3 className="text-lg font-semibold text-zinc-900">
          Reporting overview
        </h3>
        <p className="mt-1 text-sm text-zinc-600">
          Overview generated at{" "}
          <span className="tabular-nums text-zinc-800">
            {formatDateTime(overview.generated_at)}
          </span>
          .
        </p>
      </div>

      {overview.sections.length === 0 ? (
        <p className="px-6 py-6 text-sm text-zinc-600">
          No reporting sections are listed in the overview.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
            <thead className="bg-zinc-50 text-xs font-medium uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-6 py-3">Section</th>
                <th className="px-6 py-3">Title</th>
                <th className="px-6 py-3">Source view</th>
                <th className="px-6 py-3">Source RPC</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {overview.sections.map((section) => (
                <tr key={section.section_name}>
                  <td className="px-6 py-3 font-medium text-zinc-900">
                    {section.section_name}
                  </td>
                  <td className="px-6 py-3 text-zinc-700">{section.title}</td>
                  <td className="px-6 py-3 text-zinc-700">
                    {section.source_view}
                  </td>
                  <td className="px-6 py-3 text-zinc-700">
                    {section.source_rpc}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
