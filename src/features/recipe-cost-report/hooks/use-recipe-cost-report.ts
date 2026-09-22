"use client";

import { useCallback, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { recipeCostReportService } from "../services/recipe-cost-report-service";
import type {
  RecipeCostDetail,
  RecipeCostReportRow,
} from "../types/recipe-cost-report";

export function useRecipeCostReport() {
  const [rows, setRows] = useState<RecipeCostReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedRow, setSelectedRow] = useState<RecipeCostReportRow | null>(
    null,
  );
  const [detail, setDetail] = useState<RecipeCostDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await recipeCostReportService.getRecipeCostReport();

    if (result.error || !result.data) {
      setRows([]);
      setError(result.error ?? "Failed to load recipe cost.");
      setLoading(false);
      return;
    }

    setRows(result.data);
    setError(null);
    setLoading(false);
  }, []);

  useAsyncEffect(load, [load]);

  const openDetail = useCallback(async (row: RecipeCostReportRow) => {
    setSelectedRow(row);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);

    const result = await recipeCostReportService.getRecipeCostDetail(
      row.recipe_id,
    );

    if (result.error || !result.data) {
      setDetail(null);
      setDetailError(result.error ?? "Failed to load recipe cost detail.");
      setDetailLoading(false);
      return;
    }

    setDetail(result.data);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedRow(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  return {
    rows,
    loading,
    error,
    retry: load,
    selectedRow,
    detail,
    detailLoading,
    detailError,
    openDetail,
    closeDetail,
  };
}
