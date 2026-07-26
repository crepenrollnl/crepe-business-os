type ReportingWorkspaceErrorStateProps = {
  error: string;
  onRetry: () => void;
};

/**
 * Presentational error state for the reporting workspace page shell.
 */
export function ReportingWorkspaceErrorState({
  error,
  onRetry,
}: ReportingWorkspaceErrorStateProps) {
  return (
    <div
      className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800 shadow-sm"
      role="alert"
    >
      <p className="font-medium">Could not load reporting workspace</p>
      <p className="mt-1 text-sm">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800"
      >
        Retry
      </button>
    </div>
  );
}
