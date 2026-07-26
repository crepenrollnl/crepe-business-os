"use client";

import { useCallback, useEffect, useState } from "react";
import { reportingWorkspaceService } from "../services/reporting-workspace-service";
import type { ReportingWorkspace } from "../types/reporting-workspace";

/**
 * Reporting Workspace UI orchestration.
 * Loads workspace data only via reportingWorkspaceService.getReportingWorkspace.
 */
export function useReportingWorkspace() {
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

  return {
    workspace,
    loading,
    error,
    title: workspace?.workspace_title ?? "Reports",
    reportingVersion: workspace?.reporting_version ?? "-",
    generatedAt: workspace?.generated_at ?? null,
    retry: loadWorkspace,
  };
}
