"use client";

import { useCallback, useMemo, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { profitAndLossService } from "../services/profit-and-loss-service";
import type {
  ProfitAndLossPeriodMode,
  ProfitAndLossReport,
} from "../types/profit-and-loss";
import {
  monthBounds,
  resolveCustomPeriod,
} from "../utils/profit-and-loss-period";

export function useProfitAndLoss(now: Date = new Date()) {
  const [mode, setMode] = useState<ProfitAndLossPeriodMode>("month");
  const [year, setYear] = useState(() => now.getFullYear());
  const [monthIndex, setMonthIndex] = useState(() => now.getMonth());
  const [customFrom, setCustomFrom] = useState(
    () => monthBounds(now.getFullYear(), now.getMonth()).start,
  );
  const [customTo, setCustomTo] = useState(
    () => monthBounds(now.getFullYear(), now.getMonth()).end,
  );
  const [report, setReport] = useState<ProfitAndLossReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resolvedPeriod = useMemo(() => {
    if (mode === "month") {
      return monthBounds(year, monthIndex);
    }
    return resolveCustomPeriod(customFrom, customTo);
  }, [mode, year, monthIndex, customFrom, customTo]);

  const loadReport = useCallback(async () => {
    if ("error" in resolvedPeriod) {
      setReport(null);
      setError(resolvedPeriod.error);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setReport(null);

    const result = await profitAndLossService.getProfitAndLoss(
      resolvedPeriod.start,
      resolvedPeriod.end,
    );

    if (result.error || !result.data) {
      setReport(null);
      setError(result.error ?? "Failed to load profit and loss.");
      setLoading(false);
      return;
    }

    setReport(result.data);
    setError(null);
    setLoading(false);
  }, [resolvedPeriod]);

  useAsyncEffect(loadReport, [loadReport]);

  const selectMode = useCallback(
    (next: ProfitAndLossPeriodMode) => {
      if (next === "custom" && mode === "month") {
        const bounds = monthBounds(year, monthIndex);
        setCustomFrom(bounds.start);
        setCustomTo(bounds.end);
      }
      setMode(next);
    },
    [mode, year, monthIndex],
  );

  const goToPreviousMonth = useCallback(() => {
    if (monthIndex === 0) {
      setYear((current) => current - 1);
      setMonthIndex(11);
      return;
    }
    setMonthIndex((current) => current - 1);
  }, [monthIndex]);

  const goToNextMonth = useCallback(() => {
    if (monthIndex === 11) {
      setYear((current) => current + 1);
      setMonthIndex(0);
      return;
    }
    setMonthIndex((current) => current + 1);
  }, [monthIndex]);

  const onMonthChange = useCallback((nextYear: number, nextMonthIndex: number) => {
    setYear(nextYear);
    setMonthIndex(nextMonthIndex);
  }, []);

  return {
    mode,
    selectMode,
    year,
    monthIndex,
    onMonthChange,
    goToPreviousMonth,
    goToNextMonth,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    report,
    loading,
    error,
    retry: loadReport,
  };
}
