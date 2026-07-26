"use client";

import { useCallback, useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ReportingDashboardCards } from "@/features/reporting-dashboard/components/reporting-dashboard-cards";
import { ReportingDashboardEmptyOverview } from "@/features/reporting-dashboard/components/reporting-dashboard-empty-overview";
import { ReportingWorkspaceEmptyState } from "../components/reporting-workspace-empty-state";
import { ReportingWorkspaceErrorState } from "../components/reporting-workspace-error-state";
import { ReportingWorkspaceHeader } from "../components/reporting-workspace-header";
import { ReportingWorkspaceLoadingState } from "../components/reporting-workspace-loading-state";
import { ReportingWorkspaceNavigation } from "../components/reporting-workspace-navigation";
import { ReportingWorkspaceOverview } from "../components/reporting-workspace-overview";
import { reportingWorkspaceService } from "../services/reporting-workspace-service";
import type { ReportingWorkspace } from "../types/reporting-workspace";

export function ReportingWorkspacePage() {
  const [workspace, setWorkspace] = useState<ReportingWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await reportingWorkspaceService.getReportingWorkspace();

    if (result.error || !result.data) {
      setWorkspace(null);
      setError(result.error ?? "Failed to load reporting workspace");
      setLoading(false);
      return;
    }

    setWorkspace(result.data);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const title = workspace?.workspace_title ?? "Reports";
  const reportingVersion = workspace?.reporting_version ?? "-";
  const generatedAt = workspace?.generated_at ?? null;

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
              void loadWorkspace();
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
