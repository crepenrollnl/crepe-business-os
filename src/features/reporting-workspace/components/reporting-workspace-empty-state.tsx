/**
 * Presentational empty state for the reporting workspace page shell.
 */
export function ReportingWorkspaceEmptyState() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-zinc-600 shadow-sm">
      <p className="font-medium text-zinc-900">
        No reporting workspace data yet
      </p>
      <p className="mt-1 text-sm">
        Workspace metadata will appear once reporting foundations are available.
      </p>
    </div>
  );
}
