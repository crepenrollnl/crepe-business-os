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
 * Final UI integration for approved Reporting Dashboard data bindings.
 * Layout spacing is owned by ReportingDashboardPanel - this layer binds DTOs only.
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
