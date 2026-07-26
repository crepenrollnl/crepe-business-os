import { memo } from "react";
import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";
import { ReportingDashboardDataBinding } from "./reporting-dashboard-data-binding";
import { isSameOverviewProps } from "./reporting-dashboard-overview-equality";
import { ReportingDashboardPanel } from "./reporting-dashboard-panel";

type ReportingDashboardCompositionProps = {
  overview: ReportingOverview;
};

const PANEL_HEADING_ID = "reporting-dashboards-heading";
const PANEL_TITLE = "Reporting dashboards";
const GENERATED_AT_TIME_CLASS_NAME =
  "font-medium tabular-nums text-zinc-800";

/**
 * Final presentational composition for Reporting Dashboard widgets.
 * Hosted by the approved Reporting Workspace page - no duplicate page shell.
 * Values come from approved overview DTOs - never recalculated.
 */
export const ReportingDashboardComposition = memo(
  function ReportingDashboardComposition({
    overview,
  }: ReportingDashboardCompositionProps) {
    return (
      <ReportingDashboardPanel
        headingId={PANEL_HEADING_ID}
        title={PANEL_TITLE}
        description={
          <>
            Overview values from the reporting API generated at{" "}
            <time
              className={GENERATED_AT_TIME_CLASS_NAME}
              dateTime={overview.generated_at}
            >
              {overview.generated_at}
            </time>
            .
          </>
        }
      >
        <ReportingDashboardDataBinding overview={overview} />
      </ReportingDashboardPanel>
    );
  },
  isSameOverviewProps,
);
