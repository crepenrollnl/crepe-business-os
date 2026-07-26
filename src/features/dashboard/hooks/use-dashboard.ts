"use client";

import { useCallback, useEffect, useState } from "react";
import { dashboardService } from "../services/dashboard-service";
import type { DashboardSummary } from "../types/dashboard";

/**
 * Dashboard UI orchestration (DEV-043).
 * Loads KPIs only via dashboardService.getDashboardSummary.
 */
export function useDashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await dashboardService.getDashboardSummary();

    if (result.error || !result.data) {
      setSummary(null);
      setError(result.error ?? "Failed to load dashboard summary");
      setLoading(false);
      return;
    }

    setSummary(result.data);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  return {
    summary,
    loading,
    error,
    retry: loadSummary,
  };
}
