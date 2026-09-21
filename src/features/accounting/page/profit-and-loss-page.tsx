"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ProfitAndLossFilters } from "../components/profit-and-loss-filters";
import { ProfitAndLossReportView } from "../components/profit-and-loss-report";
import { useProfitAndLoss } from "../hooks/use-profit-and-loss";

export function ProfitAndLossPage() {
  const {
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
    retry,
  } = useProfitAndLoss();

  return (
    <DashboardLayout activePath="/accounting/profit-and-loss">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Profit and Loss
          </h1>
          <p className="mt-2 text-base text-zinc-600 sm:text-lg">
            Ledger P&amp;L for the selected period. Owner and partner only.
          </p>
        </div>

        <ProfitAndLossFilters
          mode={mode}
          year={year}
          monthIndex={monthIndex}
          customFrom={customFrom}
          customTo={customTo}
          onModeChange={selectMode}
          onMonthChange={onMonthChange}
          onPreviousMonth={goToPreviousMonth}
          onNextMonth={goToNextMonth}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
        />

        <ProfitAndLossReportView
          report={report}
          loading={loading}
          error={error}
          onRetry={() => {
            void retry();
          }}
        />
      </div>
    </DashboardLayout>
  );
}
