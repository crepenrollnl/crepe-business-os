import type { BusinessHealthModel } from "../types/business-health";

type BusinessHealthPanelProps = {
  model: BusinessHealthModel;
};

function overallSurfaceClass(
  level: BusinessHealthModel["overall_level"],
): string {
  if (level === "critical") {
    return "border-red-200 bg-gradient-to-br from-red-50 to-white";
  }
  if (level === "attention") {
    return "border-amber-200 bg-gradient-to-br from-amber-50 to-white";
  }
  return "border-emerald-200 bg-gradient-to-br from-emerald-50 to-white";
}

function overallTextClass(level: BusinessHealthModel["overall_level"]): string {
  if (level === "critical") {
    return "text-red-800";
  }
  if (level === "attention") {
    return "text-amber-800";
  }
  return "text-emerald-800";
}

/**
 * Prominent Business Health status panel (DEV-126.2).
 * Presentational only — values come pre-composed from the builder.
 */
export function BusinessHealthPanel({ model }: BusinessHealthPanelProps) {
  return (
    <section
      className={`rounded-2xl border p-6 shadow-sm sm:p-8 ${overallSurfaceClass(model.overall_level)}`}
      aria-label="Business health"
      data-testid="business-health-panel"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p
            className={`text-sm font-semibold uppercase tracking-[0.14em] ${overallTextClass(model.overall_level)}`}
          >
            Business Health
          </p>
          <p
            className={`mt-2 text-4xl font-bold tracking-tight sm:text-5xl ${overallTextClass(model.overall_level)}`}
            data-testid="business-health-overall-value"
          >
            {model.overall_display}
          </p>
          <p
            className="mt-2 max-w-2xl text-sm text-zinc-600 sm:text-base"
            data-testid="business-health-overall"
          >
            {model.overall_detail}
          </p>
        </div>

        <dl className="grid w-full gap-3 sm:grid-cols-2 lg:w-auto lg:min-w-[28rem] lg:grid-cols-2">
          {model.indicators.map((indicator) => (
            <div
              key={indicator.id}
              className="rounded-xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm backdrop-blur"
              data-testid={`business-health-${indicator.id}`}
            >
              <dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {indicator.label}
              </dt>
              <dd
                className="mt-1 text-lg font-semibold text-zinc-900"
                data-testid={`business-health-value-${indicator.id}`}
              >
                {indicator.display_value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
