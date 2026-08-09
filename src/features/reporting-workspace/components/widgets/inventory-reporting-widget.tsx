import { memo } from "react";
import type { InventoryDashboard } from "@/features/inventory-dashboard/types/inventory-dashboard";
import { formatDateTime } from "@/lib/date";
import { ReportingDashboardMetric } from "./reporting-dashboard-metric";
import { ReportingSectionWidget } from "./reporting-section-widget";

type InventoryReportingWidgetProps = {
  title: string;
  data: InventoryDashboard;
};

/** Binds InventoryDashboard DTO fields as-is. */
export const InventoryReportingWidget = memo(function InventoryReportingWidget({
  title,
  data,
}: InventoryReportingWidgetProps) {
  return (
    <ReportingSectionWidget title={title}>
      <ReportingDashboardMetric
        label="Total Ingredients"
        value={data.total_ingredients}
      />
      <ReportingDashboardMetric
        label="Low Stock Count"
        value={data.low_stock_count}
      />
      <ReportingDashboardMetric
        label="Out Of Stock Count"
        value={data.out_of_stock_count}
      />
      <ReportingDashboardMetric
        label="Total Inventory Value"
        value={data.total_inventory_value}
      />
      <ReportingDashboardMetric
        label="Last Purchase Date"
        value={formatDateTime(data.last_purchase_date)}
      />
      <ReportingDashboardMetric
        label="Last Production Date"
        value={formatDateTime(data.last_production_date)}
      />
    </ReportingSectionWidget>
  );
});
