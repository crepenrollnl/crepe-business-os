import type { OperationalDashboardModel } from "../types/operational-dashboard";

type OperationalDashboardSectionProps = {
  model: OperationalDashboardModel;
};

const PRIMARY_FIELD_IDS = new Set([
  "current_shift_status",
  "shift_opened_at",
  "sales_today",
]);

/**
 * Compact operational context card (DEV-126.2).
 * Hides fields already covered by Today's Summary / Business Health.
 */
export function OperationalDashboardSection({
  model,
}: OperationalDashboardSectionProps) {
  const fields = model.fields.filter(
    (field) =>
      field.availability !== "not_applicable" &&
      PRIMARY_FIELD_IDS.has(field.id),
  );

  if (fields.length === 0) {
    return null;
  }

  return (
    <section
      className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
      aria-label="Shift context"
      data-testid="operational-dashboard"
    >
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-zinc-900">Shift Context</h3>
        <p className="mt-1 text-sm text-zinc-600">
          Where the business day stands right now.
        </p>
      </div>

      <dl className="grid gap-6 sm:grid-cols-3">
        {fields.map((field, index) => (
          <div
            key={field.id}
            className={
              index > 0
                ? "sm:border-l sm:border-zinc-100 sm:pl-6"
                : undefined
            }
            data-testid={`operational-field-${field.id}`}
          >
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {field.label}
            </dt>
            <dd
              className="mt-2 text-2xl font-semibold tabular-nums text-zinc-900"
              data-testid={`operational-value-${field.id}`}
            >
              {field.display_value === "—" ? "Not available yet" : field.display_value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
