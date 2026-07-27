import type { DashboardKpiCard } from "../types/dashboard-kpi-cards";

type DashboardKpiCardsProps = {
  cards: DashboardKpiCard[];
};

function valueClass(card: DashboardKpiCard): string {
  if (
    card.id === "critical_inventory_alerts" &&
    card.numeric_value !== null &&
    card.numeric_value > 0
  ) {
    return "text-red-700";
  }
  if (card.availability === "missing" || card.availability === "empty") {
    return "text-zinc-400";
  }
  return "text-zinc-900";
}

function humanDetail(card: DashboardKpiCard): string | null {
  if (card.availability === "missing") {
    return "Not available yet";
  }
  if (card.availability === "empty" && card.id === "active_shift_status") {
    return "No open shift";
  }
  if (
    card.availability === "empty" &&
    card.id === "critical_inventory_alerts"
  ) {
    return "All clear";
  }
  return null;
}

/**
 * Compact KPI strip inside one business card (DEV-126.2).
 * Presentational only — values come pre-formatted.
 */
export function DashboardKpiCards({ cards }: DashboardKpiCardsProps) {
  if (cards.length === 0) {
    return null;
  }

  return (
    <section
      className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
      data-testid="dashboard-kpi-cards"
      aria-label="Key indicators"
    >
      <div className="mb-5">
        <h3 className="text-lg font-semibold text-zinc-900">Key Indicators</h3>
        <p className="mt-1 text-sm text-zinc-600">
          The numbers that matter most right now.
        </p>
      </div>

      <dl className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => (
          <div
            key={card.id}
            className={
              index > 0
                ? "xl:border-l xl:border-zinc-100 xl:pl-6"
                : undefined
            }
          >
            <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              {card.title}
            </dt>
            <dd
              className={`mt-2 text-3xl font-semibold tracking-tight tabular-nums ${valueClass(card)}`}
              data-testid={`dashboard-kpi-${card.id}`}
            >
              {card.display_value}
            </dd>
            {humanDetail(card) ? (
              <p className="mt-2 text-sm text-zinc-500">{humanDetail(card)}</p>
            ) : null}
          </div>
        ))}
      </dl>
    </section>
  );
}
