import { memo } from "react";
import { ReportingDashboardCard } from "../reporting-dashboard-card";

type ReportingDashboardMetricProps = {
  label: string;
  value: string | number | boolean | null;
};

const VALUE_CLASS_NAME =
  "text-2xl font-semibold leading-none tabular-nums break-all text-zinc-900 sm:text-3xl";

/**
 * Metric cell for Reporting Dashboard widgets.
 * Displays DTO values as-is; null renders as "-".
 */
export const ReportingDashboardMetric = memo(function ReportingDashboardMetric({
  label,
  value,
}: ReportingDashboardMetricProps) {
  const displayValue = value === null ? "-" : String(value);
  const accessibleName = `${label}: ${displayValue}`;

  return (
    <ReportingDashboardCard
      title={label}
      titleAs="p"
      ariaLabel={accessibleName}
    >
      <p className={VALUE_CLASS_NAME} aria-hidden="true">
        {displayValue}
      </p>
    </ReportingDashboardCard>
  );
});
