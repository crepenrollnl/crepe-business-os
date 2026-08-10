"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ExpenseForm } from "../components/expense-form";
import { ExpenseList } from "../components/expense-list";
import { useExpenses } from "../hooks/use-expenses";

export function ExpensesPage() {
  const {
    accounts,
    expenses,
    loading,
    error,
    isSaving,
    formError,
    lastPostingNumber,
    submitExpense,
    clearLastPostingNumber,
    retry,
  } = useExpenses();

  return (
    <DashboardLayout activePath="/expenses">
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Expenses
          </h1>
          <p className="mt-2 text-base text-zinc-600 sm:text-lg">
            Record operating expenses paid immediately from Cash/Bank.
          </p>
        </div>

        <ExpenseForm
          accounts={accounts}
          isSaving={isSaving}
          error={formError}
          lastPostingNumber={lastPostingNumber}
          onSubmit={submitExpense}
          onDismissSuccess={clearLastPostingNumber}
        />

        <ExpenseList
          expenses={expenses}
          loading={loading}
          error={error}
          onRetry={retry}
        />
      </div>
    </DashboardLayout>
  );
}
