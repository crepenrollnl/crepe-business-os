import type { LowStockAlert } from "@/features/inventory/types/low-stock-alert";

type DashboardLowStockAlertsSectionProps = {
  /** null = module unavailable; [] = no alerts. */
  alerts: LowStockAlert[] | null;
};

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function formatDaysRemaining(value: number | null): string {
  if (value === null) {
    return "—";
  }
  return value.toFixed(1);
}

function AlertGroup({
  title,
  tone,
  alerts,
}: {
  title: string;
  tone: "critical" | "low";
  alerts: LowStockAlert[];
}) {
  if (alerts.length === 0) {
    return null;
  }

  const containerClass =
    tone === "critical"
      ? "border-red-200 bg-red-50/70"
      : "border-amber-200 bg-amber-50/70";
  const titleClass =
    tone === "critical" ? "text-red-800" : "text-amber-800";

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${containerClass}`}
      data-testid={`dashboard-alert-group-${tone}`}
    >
      <h4 className={`text-sm font-semibold ${titleClass}`}>
        {title}{" "}
        <span className="font-medium text-zinc-600">({alerts.length})</span>
      </h4>
      <ul className="mt-2 divide-y divide-zinc-200/70">
        {alerts.map((alert) => (
          <li
            key={alert.ingredient_id}
            className="flex flex-col gap-1 py-2.5 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
            data-testid={`dashboard-alert-${alert.alert_level}`}
          >
            <div className="min-w-0">
              <p className="font-medium text-zinc-900">
                {alert.ingredient_name}
                <span className="ml-1 font-normal text-zinc-500">
                  ({alert.unit})
                </span>
              </p>
              <p className="text-zinc-600">{alert.alert_reason}</p>
            </div>
            <div className="shrink-0 text-zinc-600 sm:text-right">
              <p>
                On hand {formatQuantity(alert.current_quantity)}
                {" · "}
                {formatDaysRemaining(alert.days_remaining)} days left
              </p>
              <p>
                Suggested order{" "}
                {alert.recommended_quantity === null
                  ? "—"
                  : formatQuantity(alert.recommended_quantity)}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Inventory attention panel — empty stays quiet; missing is informational.
 */
export function DashboardLowStockAlertsSection({
  alerts,
}: DashboardLowStockAlertsSectionProps) {
  if (alerts === null) {
    return (
      <section
        className="rounded-2xl border border-zinc-200 bg-zinc-50 px-5 py-4"
        aria-label="Inventory alerts"
        data-testid="dashboard-low-stock-alerts-missing"
      >
        <h3 className="text-lg font-semibold text-zinc-900">Inventory Alerts</h3>
        <p className="mt-1 text-sm text-zinc-600">
          Inventory alerts could not be loaded right now. Everything else on
          this page still works.
        </p>
      </section>
    );
  }

  if (alerts.length === 0) {
    return (
      <section
        className="rounded-2xl border border-zinc-200 bg-white px-5 py-4 shadow-sm"
        aria-label="Inventory alerts"
        data-testid="dashboard-low-stock-alerts-empty"
      >
        <h3 className="text-lg font-semibold text-zinc-900">Inventory Alerts</h3>
        <p className="mt-1 text-sm text-zinc-600">
          Stock looks steady — no ingredients need attention right now.
        </p>
      </section>
    );
  }

  const critical = alerts.filter((alert) => alert.alert_level === "critical");
  const low = alerts.filter((alert) => alert.alert_level === "low");

  return (
    <section
      className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
      aria-label="Inventory alerts"
      data-testid="dashboard-low-stock-alerts"
    >
      <div>
        <h3 className="text-lg font-semibold text-zinc-900">Inventory Alerts</h3>
        <p className="mt-1 text-sm text-zinc-600">
          Ingredients that may need a purchase soon.
        </p>
      </div>
      <AlertGroup title="Needs attention now" tone="critical" alerts={critical} />
      <AlertGroup title="Watch closely" tone="low" alerts={low} />
    </section>
  );
}
