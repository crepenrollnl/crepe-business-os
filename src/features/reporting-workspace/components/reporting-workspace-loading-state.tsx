/**
 * Presentational loading state for the reporting workspace page shell.
 */
export function ReportingWorkspaceLoadingState() {
  return (
    <div
      className="rounded-xl border border-zinc-200 bg-white p-8 text-center text-zinc-600 shadow-sm"
      role="status"
      aria-live="polite"
    >
      Loading reporting workspace...
    </div>
  );
}
