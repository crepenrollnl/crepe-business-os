import { memo } from "react";
import type { UserActivityDashboard } from "@/features/user-activity-dashboard/types/user-activity-dashboard";
import { formatDateTime } from "@/lib/date";
import { ReportingDashboardMetric } from "./reporting-dashboard-metric";
import { ReportingSectionWidget } from "./reporting-section-widget";

type UserActivityReportingWidgetProps = {
  title: string;
  data: UserActivityDashboard;
};

/** Binds UserActivityDashboard DTO fields as-is. */
export const UserActivityReportingWidget = memo(
  function UserActivityReportingWidget({
    title,
    data,
  }: UserActivityReportingWidgetProps) {
    return (
      <ReportingSectionWidget title={title}>
        <ReportingDashboardMetric
          label="Active Users Today"
          value={data.active_users_today}
        />
        <ReportingDashboardMetric
          label="Active Users Last 7 Days"
          value={data.active_users_last_7_days}
        />
        <ReportingDashboardMetric
          label="Total User Actions"
          value={data.total_user_actions}
        />
        <ReportingDashboardMetric
          label="Production Actions"
          value={data.production_actions}
        />
        <ReportingDashboardMetric
          label="Inventory Actions"
          value={data.inventory_actions}
        />
        <ReportingDashboardMetric
          label="Purchase Actions"
          value={data.purchase_actions}
        />
        <ReportingDashboardMetric
          label="Sales Actions"
          value={data.sales_actions}
        />
        <ReportingDashboardMetric
          label="Last User Activity At"
          value={formatDateTime(data.last_user_activity_at)}
        />
        <ReportingDashboardMetric
          label="Most Active User"
          value={data.most_active_user}
        />
        <ReportingDashboardMetric
          label="Average Actions Per User"
          value={data.average_actions_per_user}
        />
      </ReportingSectionWidget>
    );
  },
);
