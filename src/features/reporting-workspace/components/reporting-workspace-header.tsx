type ReportingWorkspaceHeaderProps = {
  title: string;
  reportingVersion: string;
  generatedAt: string | null;
};

/**
 * Presentational workspace header. Values come from ReportingWorkspace as-is.
 */
export function ReportingWorkspaceHeader({
  title,
  reportingVersion,
  generatedAt,
}: ReportingWorkspaceHeaderProps) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            {title}
          </h2>
          <p className="mt-2 text-base text-zinc-600 sm:text-lg">
            Reporting workspace entry point for dashboards and overview data.
          </p>
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600">
          <div>
            <dt className="inline font-medium text-zinc-900">Version </dt>
            <dd className="inline tabular-nums">{reportingVersion}</dd>
          </div>
          <div>
            <dt className="inline font-medium text-zinc-900">Generated </dt>
            <dd className="inline tabular-nums">{generatedAt ?? "-"}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
