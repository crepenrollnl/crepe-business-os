import { memo } from "react";
import type { ProductionDashboard } from "@/features/production-dashboard/types/production-dashboard";
import { formatDateTime } from "@/lib/date";
import { ReportingDashboardMetric } from "./reporting-dashboard-metric";
import { ReportingSectionWidget } from "./reporting-section-widget";

type ProductionReportingWidgetProps = {
  title: string;
  data: ProductionDashboard;
};

/** Binds ProductionDashboard DTO fields as-is. */
export const ProductionReportingWidget = memo(function ProductionReportingWidget({
  title,
  data,
}: ProductionReportingWidgetProps) {
  return (
    <ReportingSectionWidget title={title}>
      <ReportingDashboardMetric
        label="Total Batches"
        value={data.total_batches}
      />
      <ReportingDashboardMetric
        label="Completed Batches"
        value={data.completed_batches}
      />
      <ReportingDashboardMetric
        label="Failed Batches"
        value={data.failed_batches}
      />
      <ReportingDashboardMetric
        label="Total Finished Goods"
        value={data.total_finished_goods}
      />
      <ReportingDashboardMetric
        label="Last Production Date"
        value={formatDateTime(data.last_production_date)}
      />
      <ReportingDashboardMetric
        label="Average Batch Duration"
        value={data.average_batch_duration}
      />
    </ReportingSectionWidget>
  );
});
