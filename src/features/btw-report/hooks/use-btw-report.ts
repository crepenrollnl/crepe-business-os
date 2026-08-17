"use client";

import { useCallback, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { btwReportService } from "../services/btw-report-service";
import type { BtwReport } from "../types/btw-report";

function currentQuarter(now: Date): number {
  return Math.floor(now.getMonth() / 3) + 1;
}

export function useBtwReport() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(currentQuarter(now));
  const [report, setReport] = useState<BtwReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await btwReportService.getBtwReport(year, quarter);

    if (result.error || !result.data) {
      setReport(null);
      setError(result.error ?? "Failed to load BTW report.");
      setLoading(false);
      return;
    }

    setReport(result.data);
    setError(null);
    setLoading(false);
  }, [year, quarter]);

  useAsyncEffect(loadReport, [loadReport]);

  const onPeriodChange = useCallback((nextYear: number, nextQuarter: number) => {
    setYear(nextYear);
    setQuarter(nextQuarter);
  }, [setYear, setQuarter]);

  return {
    year,
    quarter,
    report,
    loading,
    error,
    onPeriodChange,
    retry: loadReport,
  };
}
