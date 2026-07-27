import type { LowStockAlert } from "../types/low-stock-alert";
import { groupLowStockAlertsBySeverity } from "../utils/low-stock-alert-builder";

type LowStockAlertsPanelProps = {
  alerts: LowStockAlert[];
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
      ? "border-red-200 bg-red-50/80"
      : "border-amber-200 bg-amber-50/80";
  const titleClass =
    tone === "critical" ? "text-red-800" : "text-amber-800";

  return (
    <div
      className={`rounded-xl border px-4 py-3 ${containerClass}`}
      data-testid={`low-stock-alert-group-${tone}`}
    >
      <h3 className={`text-sm font-semibold ${titleClass}`}>
        {title}{" "}
        <span className="font-medium text-zinc-600">({alerts.length})</span>
      </h3>
      <ul className="mt-2 divide-y divide-zinc-200/70">
        {alerts.map((alert) => (
          <li
            key={alert.ingredient_id}
            className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
            data-testid={`low-stock-alert-${alert.alert_level}`}
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
                Qty {formatQuantity(alert.current_quantity)}
                {" · "}
                {formatDaysRemaining(alert.days_remaining)} days
              </p>
              <p>
                Recommended{" "}
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

export function LowStockAlertsPanel({ alerts }: LowStockAlertsPanelProps) {
  if (alerts.length === 0) {
    return null;
  }

  const { critical, low } = groupLowStockAlertsBySeverity(alerts);

  return (
    <section
      className="space-y-3"
      aria-label="Low stock alerts"
      data-testid="low-stock-alerts-panel"
    >
      <div>
        <h2 className="text-sm font-semibold text-zinc-900">Low Stock Alerts</h2>
        <p className="text-sm text-zinc-600">
          Informational only — based on forecast and purchase recommendations.
        </p>
      </div>
      <AlertGroup title="🔴 Critical" tone="critical" alerts={critical} />
      <AlertGroup title="🟡 Low" tone="low" alerts={low} />
    </section>
  );
}
