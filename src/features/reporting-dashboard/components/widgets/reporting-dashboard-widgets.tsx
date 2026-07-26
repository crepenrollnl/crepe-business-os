import { memo } from "react";
import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";
import { isSameOverviewProps } from "../reporting-dashboard-overview-equality";
import { AlertsReportingWidget } from "./alerts-reporting-widget";
import { AuditReportingWidget } from "./audit-reporting-widget";
import { CompanyReportingWidget } from "./company-reporting-widget";
import { ExecutiveReportingWidget } from "./executive-reporting-widget";
import { InventoryReportingWidget } from "./inventory-reporting-widget";
import { KpiReportingWidget } from "./kpi-reporting-widget";
import { ProductionReportingWidget } from "./production-reporting-widget";
import { UserActivityReportingWidget } from "./user-activity-reporting-widget";

type ReportingDashboardWidgetsProps = {
  overview: ReportingOverview;
};

const SECTION_TITLES = {
  executive: "Executive Dashboard",
  kpi: "KPI Dashboard",
  company: "Company Dashboard",
  inventory: "Inventory Dashboard",
  production: "Production Dashboard",
  alerts: "Alerts Dashboard",
  audit: "Audit Dashboard",
  user_activity: "User Activity Dashboard",
} as const;

const LIST_CLASS_NAME = "m-0 list-none space-y-6 p-0 sm:space-y-8";
const LIST_ARIA_LABEL = "Reporting dashboard section widgets";
const LIST_ITEM_CLASS_NAME = "min-w-0";

/**
 * Reusable presentational widgets for Reporting API overview sections.
 * Owns section list spacing only - outer panel spacing stays in ReportingDashboardPanel.
 */
export const ReportingDashboardWidgets = memo(function ReportingDashboardWidgets({
  overview,
}: ReportingDashboardWidgetsProps) {
  return (
    <ul className={LIST_CLASS_NAME} aria-label={LIST_ARIA_LABEL}>
      <li className={LIST_ITEM_CLASS_NAME}>
        <ExecutiveReportingWidget
          title={SECTION_TITLES.executive}
          data={overview.executive}
        />
      </li>
      <li className={LIST_ITEM_CLASS_NAME}>
        <KpiReportingWidget title={SECTION_TITLES.kpi} data={overview.kpi} />
      </li>
      <li className={LIST_ITEM_CLASS_NAME}>
        <CompanyReportingWidget
          title={SECTION_TITLES.company}
          data={overview.company}
        />
      </li>
      <li className={LIST_ITEM_CLASS_NAME}>
        <InventoryReportingWidget
          title={SECTION_TITLES.inventory}
          data={overview.inventory}
        />
      </li>
      <li className={LIST_ITEM_CLASS_NAME}>
        <ProductionReportingWidget
          title={SECTION_TITLES.production}
          data={overview.production}
        />
      </li>
      <li className={LIST_ITEM_CLASS_NAME}>
        <AlertsReportingWidget
          title={SECTION_TITLES.alerts}
          data={overview.alerts}
        />
      </li>
      <li className={LIST_ITEM_CLASS_NAME}>
        <AuditReportingWidget
          title={SECTION_TITLES.audit}
          data={overview.audit}
        />
      </li>
      <li className={LIST_ITEM_CLASS_NAME}>
        <UserActivityReportingWidget
          title={SECTION_TITLES.user_activity}
          data={overview.user_activity}
        />
      </li>
    </ul>
  );
}, isSameOverviewProps);
