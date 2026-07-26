import { memo } from "react";
import type { AuditDashboard } from "@/features/audit-dashboard/types/audit-dashboard";
import { ReportingDashboardMetric } from "./reporting-dashboard-metric";
import { ReportingSectionWidget } from "./reporting-section-widget";

type AuditReportingWidgetProps = {
  title: string;
  data: AuditDashboard;
};

/**
 * Presentational widget for the audit Reporting API overview section.
 * Binds approved AuditDashboard DTO fields as-is.
 */
export const AuditReportingWidget = memo(function AuditReportingWidget({
  title,
  data,
}: AuditReportingWidgetProps) {
  return (
    <ReportingSectionWidget title={title}>
      <ReportingDashboardMetric
        label="Total Audit Events"
        value={data.total_audit_events}
      />
      <ReportingDashboardMetric
        label="Events Today"
        value={data.events_today}
      />
      <ReportingDashboardMetric
        label="Events Last 7 Days"
        value={data.events_last_7_days}
      />
      <ReportingDashboardMetric
        label="Failed Operations"
        value={data.failed_operations}
      />
      <ReportingDashboardMetric
        label="User Activity Count"
        value={data.user_activity_count}
      />
      <ReportingDashboardMetric
        label="Production Events"
        value={data.production_events}
      />
      <ReportingDashboardMetric
        label="Inventory Events"
        value={data.inventory_events}
      />
      <ReportingDashboardMetric
        label="Sales Events"
        value={data.sales_events}
      />
      <ReportingDashboardMetric
        label="Purchase Events"
        value={data.purchase_events}
      />
      <ReportingDashboardMetric
        label="Last Audit Event At"
        value={data.last_audit_event_at}
      />
    </ReportingSectionWidget>
  );
});
