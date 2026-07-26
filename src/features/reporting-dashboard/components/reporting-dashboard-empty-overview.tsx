import { memo } from "react";
import { ReportingDashboardPanel } from "./reporting-dashboard-panel";

const EMPTY_HEADING_ID = "reporting-dashboards-empty-heading";
const PANEL_TITLE = "Reporting dashboards";
const EMPTY_MESSAGE_CLASS_NAME = "text-sm leading-relaxed text-zinc-600";
const EMPTY_MESSAGE = "No reporting dashboard cards are available yet.";

const EMPTY_OVERVIEW_BODY = (
  <p className={EMPTY_MESSAGE_CLASS_NAME} role="status">
    {EMPTY_MESSAGE}
  </p>
);

/**
 * Presentational empty state when Reporting API overview is unavailable.
 * Reuses the same panel shell as the bound composition - no duplicate containers.
 */
export const ReportingDashboardEmptyOverview = memo(
  function ReportingDashboardEmptyOverview() {
    return (
      <ReportingDashboardPanel headingId={EMPTY_HEADING_ID} title={PANEL_TITLE}>
        {EMPTY_OVERVIEW_BODY}
      </ReportingDashboardPanel>
    );
  },
);
