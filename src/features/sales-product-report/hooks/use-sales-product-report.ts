"use client";

import { useCallback, useMemo, useState } from "react";
import { shiftService } from "@/features/shifts/services/shift-service";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { salesProductReportService } from "../services/sales-product-report-service";
import type {
  SalesByProductPreset,
  SalesByProductRow,
  SalesByProductSortDirection,
  SalesByProductSortField,
} from "../types/sales-product-report";
import {
  formatLocalDateInput,
  resolveSalesByProductPeriod,
} from "../utils/sales-product-period";

function compareRows(
  left: SalesByProductRow,
  right: SalesByProductRow,
  field: SalesByProductSortField,
  direction: SalesByProductSortDirection,
): number {
  const sign = direction === "asc" ? 1 : -1;
  if (field === "product_name") {
    return sign * left.product_name.localeCompare(right.product_name);
  }
  if (field === "gross_margin_percent") {
    const leftValue = left.gross_margin_percent;
    const rightValue = right.gross_margin_percent;
    if (leftValue === null && rightValue === null) {
      return 0;
    }
    if (leftValue === null) {
      return 1;
    }
    if (rightValue === null) {
      return -1;
    }
    return sign * (leftValue - rightValue);
  }
  return sign * (left[field] - right[field]);
}

export function useSalesProductReport() {
  const [preset, setPreset] = useState<SalesByProductPreset>("today");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [search, setSearch] = useState("");
  const [sortField, setSortField] =
    useState<SalesByProductSortField>("revenue");
  const [sortDirection, setSortDirection] =
    useState<SalesByProductSortDirection>("desc");
  const [rows, setRows] = useState<SalesByProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);

    let shift = null;
    if (preset === "this_shift") {
      const activeResult = await shiftService.getActiveShift();
      if (activeResult.error) {
        setRows([]);
        setError(activeResult.error);
        setLoading(false);
        return;
      }
      if (activeResult.data) {
        shift = activeResult.data;
      } else {
        const closedResult = await shiftService.getLatestClosedShift();
        if (closedResult.error) {
          setRows([]);
          setError(closedResult.error);
          setLoading(false);
          return;
        }
        shift = closedResult.data;
      }
    }

    const period = resolveSalesByProductPeriod({
      preset,
      shift,
      customFrom,
      customTo,
    });

    if (period.error || !period.data) {
      setRows([]);
      setError(period.error ?? "Period is invalid.");
      setLoading(false);
      return;
    }

    const result = await salesProductReportService.listForPeriod(period.data);
    if (result.error || !result.data) {
      setRows([]);
      setError(result.error ?? "Failed to load sales by product");
      setLoading(false);
      return;
    }

    setRows(result.data);
    setError(null);
    setLoading(false);
  }, [preset, customFrom, customTo]);

  useAsyncEffect(loadReport, [loadReport]);

  const selectPreset = useCallback(
    (next: SalesByProductPreset) => {
      setPreset(next);
      if (next === "custom" && !customFrom && !customTo) {
        const today = formatLocalDateInput(new Date());
        setCustomFrom(today);
        setCustomTo(today);
      }
    },
    [customFrom, customTo],
  );

  const toggleSort = useCallback((field: SalesByProductSortField) => {
    setSortField((current) => {
      if (current === field) {
        setSortDirection((direction) =>
          direction === "asc" ? "desc" : "asc",
        );
        return current;
      }
      setSortDirection(field === "product_name" ? "asc" : "desc");
      return field;
    });
  }, []);

  const visibleRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filtered = needle
      ? rows.filter((row) => row.product_name.toLowerCase().includes(needle))
      : rows;
    return [...filtered].sort((left, right) =>
      compareRows(left, right, sortField, sortDirection),
    );
  }, [rows, search, sortField, sortDirection]);

  return {
    preset,
    setPreset,
    selectPreset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    search,
    setSearch,
    sortField,
    sortDirection,
    toggleSort,
    rows: visibleRows,
    loading,
    error,
    retry: loadReport,
  };
}
