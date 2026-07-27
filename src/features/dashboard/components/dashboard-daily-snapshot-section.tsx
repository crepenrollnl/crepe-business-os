import type { DashboardSnapshotField } from "../types/dashboard-completion";

type DashboardDailySnapshotSectionProps = {
  fields: DashboardSnapshotField[];
};

function humanEmptyCopy(field: DashboardSnapshotField): string {
  if (field.availability === "empty") {
    return "Waiting on close-of-day review.";
  }
  if (field.availability === "missing") {
    return "Not available yet.";
  }
  return field.detail ?? "";
}

/**
 * Compact Today's Summary card (DEV-126.2).
 * Presentational only — values are pre-formatted.
 */
export function DashboardDailySnapshotSection({
  fields,
}: DashboardDailySnapshotSectionProps) {
  const visibleFields = fields.filter(
    (field) => field.availability !== "not_applicable",
  );

  if (visibleFields.length === 0) {
    return (
      <section
        className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
        aria-label="Today's summary"
        data-testid="dashboard-daily-snapshot"
      >
        <h3 className="text-lg font-semibold text-zinc-900">Today&apos;s Summary</h3>
        <p className="mt-2 text-sm text-zinc-600">
          Close the shift to see today&apos;s revenue, profit, and cash status.
        </p>
      </section>
    );
  }

  return (
    <section
      className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
      aria-label="Today's summary"
      data-testid="dashboard-daily-snapshot"
    >
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-zinc-900">Today&apos;s Summary</h3>
        <p className="mt-1 text-sm text-zinc-600">
          A quick read of today&apos;s money and cash position.
        </p>
      </div>

      <dl className="grid gap-6 sm:grid-cols-3">
        {visibleFields.map((field, index) => (
          <div
            key={field.id}
            className={
              index > 0
                ? "sm:border-l sm:border-zinc-100 sm:pl-6"
                : undefined
            }
            data-testid={`dashboard-snapshot-${field.id}`}
          >
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {field.label}
            </dt>
            <dd
              className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-zinc-900"
              data-testid={`dashboard-snapshot-value-${field.id}`}
            >
              {field.display_value}
            </dd>
            {field.availability !== "available" ? (
              <p className="mt-2 text-sm text-zinc-500">
                {humanEmptyCopy(field)}
              </p>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
