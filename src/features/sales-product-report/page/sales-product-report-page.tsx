"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { SalesProductReportFilters } from "../components/sales-product-report-filters";
import { SalesProductReportTable } from "../components/sales-product-report-table";
import { useSalesProductReport } from "../hooks/use-sales-product-report";

export function SalesProductReportPage() {
  const {
    preset,
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
    rows,
    loading,
    error,
    retry,
  } = useSalesProductReport();

  return (
    <DashboardLayout activePath="/reports/sales-by-product">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Sales by Product
          </h1>
          <p className="mt-2 text-base text-zinc-600 sm:text-lg">
            Quantity, net revenue, COGS, profit and margin for each product in
            the selected period. Revenue is net of VAT.
          </p>
        </div>

        <SalesProductReportFilters
          preset={preset}
          customFrom={customFrom}
          customTo={customTo}
          search={search}
          onPresetChange={selectPreset}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
          onSearchChange={setSearch}
        />

        <SalesProductReportTable
          rows={rows}
          loading={loading}
          error={error}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={toggleSort}
          onRetry={() => {
            void retry();
          }}
        />
      </div>
    </DashboardLayout>
  );
}
