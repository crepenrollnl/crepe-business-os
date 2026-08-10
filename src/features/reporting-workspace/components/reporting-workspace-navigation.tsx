import type { DashboardNavigationItem } from "@/features/dashboard-navigation/types/dashboard-navigation";

type ReportingWorkspaceNavigationProps = {
  items: DashboardNavigationItem[];
};

/**
 * Presentational dashboard navigation catalog.
 * Displays SQL-provided navigation metadata without filtering or sorting.
 */
export function ReportingWorkspaceNavigation({
  items,
}: ReportingWorkspaceNavigationProps) {
  if (items.length === 0) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-zinc-900">
          Dashboard navigation
        </h3>
        <p className="mt-2 text-sm text-zinc-600">
          No dashboard navigation entries are available yet.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-6 py-4">
        <h3 className="text-lg font-semibold text-zinc-900">
          Dashboard navigation
        </h3>
        <p className="mt-1 text-sm text-zinc-600">
          Discovery catalog from the reporting workspace.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
          <thead className="bg-zinc-50 text-xs font-medium uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-6 py-3">Dashboard</th>
              <th className="px-6 py-3">Category</th>
              <th className="px-6 py-3">Description</th>
              <th className="px-6 py-3">Sort</th>
              <th className="px-6 py-3">Icon</th>
              <th className="px-6 py-3">Availability</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {items.map((item) => (
              <tr key={item.dashboard_key} className="align-top">
                <td className="px-6 py-3">
                  <div className="font-medium text-zinc-900">
                    {item.display_name}
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500">
                    {item.dashboard_key}
                  </div>
                </td>
                <td className="px-6 py-3 text-zinc-700">{item.category}</td>
                <td className="max-w-md px-6 py-3 text-zinc-600">
                  {item.description}
                </td>
                <td className="px-6 py-3 tabular-nums text-zinc-700">
                  {item.sort_order}
                </td>
                <td className="px-6 py-3 text-zinc-700">
                  {item.icon_identifier}
                </td>
                <td className="px-6 py-3 text-zinc-700">{item.availability}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
