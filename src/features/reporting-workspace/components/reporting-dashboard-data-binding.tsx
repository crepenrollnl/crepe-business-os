import { memo } from "react";
import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";
import { isSameOverviewProps } from "./reporting-dashboard-overview-equality";
import { ReportingDashboardWidgets } from "./widgets/reporting-dashboard-widgets";

type ReportingDashboardDataBindingProps = {
  overview: ReportingOverview;
};

const REGION_ARIA_LABEL = "Bound reporting dashboard overview";
const REGION_CLASS_NAME = "min-w-0";

/**
 * Binds approved overview DTOs to Reporting Dashboard widgets.
 * Layout spacing is owned by ReportingDashboardPanel.
 */
export const ReportingDashboardDataBinding = memo(
  function ReportingDashboardDataBinding({
    overview,
  }: ReportingDashboardDataBindingProps) {
    return (
      <div
        role="region"
        aria-label={REGION_ARIA_LABEL}
        data-reporting-generated-at={overview.generated_at}
        className={REGION_CLASS_NAME}
      >
        <ReportingDashboardWidgets overview={overview} />
      </div>
    );
  },
  isSameOverviewProps,
);
