import { memo } from "react";
import type { CompanyDashboard } from "@/features/company-dashboard/types/company-dashboard";
import { ReportingDashboardMetric } from "./reporting-dashboard-metric";
import { ReportingSectionWidget } from "./reporting-section-widget";

type CompanyReportingWidgetProps = {
  title: string;
  data: CompanyDashboard;
};

/**
 * Presentational widget for the company Reporting API overview section.
 * Binds approved CompanyDashboard DTO fields as-is.
 */
export const CompanyReportingWidget = memo(function CompanyReportingWidget({
  title,
  data,
}: CompanyReportingWidgetProps) {
  return (
    <ReportingSectionWidget title={title}>
      <ReportingDashboardMetric
        label="Total Suppliers"
        value={data.total_suppliers}
      />
      <ReportingDashboardMetric
        label="Total Customers"
        value={data.total_customers}
      />
      <ReportingDashboardMetric
        label="Total Recipes"
        value={data.total_recipes}
      />
      <ReportingDashboardMetric
        label="Total Ingredients"
        value={data.total_ingredients}
      />
      <ReportingDashboardMetric
        label="Total Finished Goods"
        value={data.total_finished_goods}
      />
      <ReportingDashboardMetric label="Total Sales" value={data.total_sales} />
      <ReportingDashboardMetric
        label="Total Purchases"
        value={data.total_purchases}
      />
      <ReportingDashboardMetric
        label="Total Production Batches"
        value={data.total_production_batches}
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
