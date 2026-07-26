import { memo } from "react";
import type { ExecutiveDashboard } from "@/features/executive-dashboard/types/executive-dashboard";
import { ReportingDashboardMetric } from "./reporting-dashboard-metric";
import { ReportingSectionWidget } from "./reporting-section-widget";

type ExecutiveReportingWidgetProps = {
  title: string;
  data: ExecutiveDashboard;
};

/**
 * Presentational widget for the executive Reporting API overview section.
 * Binds approved ExecutiveDashboard DTO fields as-is.
 */
export const ExecutiveReportingWidget = memo(function ExecutiveReportingWidget({
  title,
  data,
}: ExecutiveReportingWidgetProps) {
  return (
    <ReportingSectionWidget title={title}>
      <ReportingDashboardMetric
        label="Company Health"
        value={data.company_health}
      />
      <ReportingDashboardMetric
        label="Inventory Value"
        value={data.inventory_value}
      />
      <ReportingDashboardMetric
        label="Low Stock Count"
        value={data.low_stock_count}
      />
      <ReportingDashboardMetric label="Total Sales" value={data.total_sales} />
      <ReportingDashboardMetric
        label="Total Purchases"
        value={data.total_purchases}
      />
      <ReportingDashboardMetric
        label="Total Batches"
        value={data.total_batches}
      />
      <ReportingDashboardMetric
        label="Sales Growth"
        value={data.sales_growth}
      />
      <ReportingDashboardMetric
        label="Last Sale Date"
        value={data.last_sale_date}
      />
      <ReportingDashboardMetric
        label="Last Purchase Date"
        value={data.last_purchase_date}
      />
      <ReportingDashboardMetric
        label="Last Production Date"
        value={data.last_production_date}
      />
    </ReportingSectionWidget>
  );
});
