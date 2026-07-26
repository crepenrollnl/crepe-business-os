import { memo } from "react";
import type { KpiDashboard } from "@/features/kpi-dashboard/types/kpi-dashboard";
import { ReportingDashboardMetric } from "./reporting-dashboard-metric";
import { ReportingSectionWidget } from "./reporting-section-widget";

type KpiReportingWidgetProps = {
  title: string;
  data: KpiDashboard;
};

/**
 * Presentational widget for the KPI Reporting API overview section.
 * Binds approved KpiDashboard DTO fields as-is.
 */
export const KpiReportingWidget = memo(function KpiReportingWidget({
  title,
  data,
}: KpiReportingWidgetProps) {
  return (
    <ReportingSectionWidget title={title}>
      <ReportingDashboardMetric
        label="Gross Revenue"
        value={data.gross_revenue}
      />
      <ReportingDashboardMetric
        label="Total Orders"
        value={data.total_orders}
      />
      <ReportingDashboardMetric
        label="Average Order Value"
        value={data.average_order_value}
      />
      <ReportingDashboardMetric
        label="Inventory Turnover"
        value={data.inventory_turnover}
      />
      <ReportingDashboardMetric
        label="Recipe Cost Average"
        value={data.recipe_cost_average}
      />
      <ReportingDashboardMetric
        label="Supplier Count"
        value={data.supplier_count}
      />
      <ReportingDashboardMetric
        label="Customer Count"
        value={data.customer_count}
      />
      <ReportingDashboardMetric
        label="Production Efficiency"
        value={data.production_efficiency}
      />
      <ReportingDashboardMetric
        label="Low Stock Ratio"
        value={data.low_stock_ratio}
      />
      <ReportingDashboardMetric
        label="Sales Growth"
        value={data.sales_growth}
      />
    </ReportingSectionWidget>
  );
});
