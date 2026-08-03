"use client";

import { useCallback, useEffect, useState } from "react";
import { expenseService } from "../services/expense-service";
import type {
  ExpenseAccountOption,
  ExpenseEntryWithRelations,
  RecordExpenseInput,
} from "../types/expense";

interface UseExpensesState {
  accounts: ExpenseAccountOption[];
  expenses: ExpenseEntryWithRelations[];
  loading: boolean;
  error: string | null;
  isSaving: boolean;
  formError: string | null;
  lastPostingNumber: string | null;
}

async function fetchExpensesState() {
  const [accountsResult, expensesResult] = await Promise.all([
    expenseService.getExpenseAccounts(),
    expenseService.listExpenses(),
  ]);

  return {
    accounts: accountsResult.error ? [] : (accountsResult.data ?? []),
    expenses: expensesResult.error ? [] : (expensesResult.data ?? []),
    error: accountsResult.error ?? expensesResult.error ?? null,
  };
}

export function useExpenses() {
  const [state, setState] = useState<UseExpensesState>({
    accounts: [],
    expenses: [],
    loading: true,
    error: null,
    isSaving: false,
    formError: null,
    lastPostingNumber: null,
  });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const next = await fetchExpensesState();
    setState((prev) => ({
      ...prev,
      accounts: next.accounts,
      expenses: next.expenses,
      error: next.error,
      loading: false,
    }));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitExpense = useCallback(async (input: RecordExpenseInput) => {
    setState((prev) => ({ ...prev, isSaving: true, formError: null }));

    const result = await expenseService.recordExpense(input);

    if (result.error !== null) {
      setState((prev) => ({
        ...prev,
        isSaving: false,
        formError: result.error,
      }));
      return false;
    }

    const expensesResult = await expenseService.listExpenses();

    setState((prev) => ({
      ...prev,
      isSaving: false,
      formError: null,
      lastPostingNumber: result.data.postingNumber,
      expenses: expensesResult.error ? prev.expenses : (expensesResult.data ?? []),
    }));

    return true;
  }, []);

  const clearLastPostingNumber = useCallback(() => {
    setState((prev) => ({ ...prev, lastPostingNumber: null }));
  }, []);

  return {
    accounts: state.accounts,
    expenses: state.expenses,
    loading: state.loading,
    error: state.error,
    isSaving: state.isSaving,
    formError: state.formError,
    lastPostingNumber: state.lastPostingNumber,
    submitExpense,
    clearLastPostingNumber,
    retry: load,
  };
}
