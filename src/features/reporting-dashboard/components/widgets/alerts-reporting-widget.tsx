import { memo } from "react";
import type { AlertsDashboard } from "@/features/alerts-dashboard/types/alerts-dashboard";
import { ReportingDashboardMetric } from "./reporting-dashboard-metric";
import { ReportingSectionWidget } from "./reporting-section-widget";

type AlertsReportingWidgetProps = {
  title: string;
  data: AlertsDashboard;
};

/**
 * Presentational widget for the alerts Reporting API overview section.
 * Binds approved AlertsDashboard DTO fields as-is.
 */
export const AlertsReportingWidget = memo(function AlertsReportingWidget({
  title,
  data,
}: AlertsReportingWidgetProps) {
  return (
    <ReportingSectionWidget title={title}>
      <ReportingDashboardMetric
        label="Low Stock Alerts"
        value={data.low_stock_alerts}
      />
      <ReportingDashboardMetric
        label="Out Of Stock Alerts"
        value={data.out_of_stock_alerts}
      />
      <ReportingDashboardMetric
        label="Overdue Production"
        value={data.overdue_production}
      />
      <ReportingDashboardMetric
        label="Failed Batches"
        value={data.failed_batches}
      />
      <ReportingDashboardMetric
        label="Stale Purchase Prices"
        value={data.stale_purchase_prices}
      />
      <ReportingDashboardMetric
        label="Inactive Suppliers"
        value={data.inactive_suppliers}
      />
      <ReportingDashboardMetric
        label="Declining Sales"
        value={data.declining_sales}
      />
      <ReportingDashboardMetric
        label="Missing Company Settings"
        value={data.missing_company_settings}
      />
      <ReportingDashboardMetric
        label="Backup Status"
        value={data.backup_status}
      />
      <ReportingDashboardMetric
        label="Import Export Failures"
        value={data.import_export_failures}
      />
    </ReportingSectionWidget>
  );
});
