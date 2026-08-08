"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ReportingDashboardCards } from "../components/reporting-dashboard-cards";
import { ReportingDashboardEmptyOverview } from "../components/reporting-dashboard-empty-overview";
import { ReportingWorkspaceEmptyState } from "../components/reporting-workspace-empty-state";
import { ReportingWorkspaceErrorState } from "../components/reporting-workspace-error-state";
import { ReportingWorkspaceHeader } from "../components/reporting-workspace-header";
import { ReportingWorkspaceLoadingState } from "../components/reporting-workspace-loading-state";
import { ReportingWorkspaceNavigation } from "../components/reporting-workspace-navigation";
import { ReportingWorkspaceOverview } from "../components/reporting-workspace-overview";
import { useReportingWorkspace } from "../hooks/use-reporting-workspace";

export function ReportingWorkspacePage() {
  const {
    workspace,
    loading,
    error,
    title,
    reportingVersion,
    generatedAt,
    retry,
  } = useReportingWorkspace();

  return (
    <DashboardLayout activePath="/reports">
      <div className="mx-auto max-w-7xl">
        <ReportingWorkspaceHeader
          title={title}
          reportingVersion={reportingVersion}
          generatedAt={generatedAt}
        />

        {loading ? <ReportingWorkspaceLoadingState /> : null}

        {!loading && error ? (
          <ReportingWorkspaceErrorState
            error={error}
            onRetry={() => {
              void retry();
            }}
          />
        ) : null}

        {!loading && !error && !workspace ? (
          <ReportingWorkspaceEmptyState />
        ) : null}

        {!loading && !error && workspace ? (
          <div className="space-y-6">
            {workspace.reporting_overview ? (
              <ReportingDashboardCards
                overview={workspace.reporting_overview}
              />
            ) : (
              <ReportingDashboardEmptyOverview />
            )}
            <ReportingWorkspaceNavigation
              items={workspace.navigation_catalog}
            />
            <ReportingWorkspaceOverview
              overview={workspace.reporting_overview}
            />
          </div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
