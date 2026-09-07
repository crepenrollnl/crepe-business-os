"use client";

import { useCallback, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { writeOffAccountingService } from "../services/write-off-accounting-service";
import { writeOffService } from "../services/write-off-service";
import type {
  RecordWriteOffInput,
  WriteOffIngredientOption,
  WriteOffProductOption,
  WriteOffRecord,
} from "../types/write-off";
import { defaultWriteOffPeriod } from "../utils/write-off-period";

interface UseWriteOffsState {
  writeOffs: WriteOffRecord[];
  ingredients: WriteOffIngredientOption[];
  products: WriteOffProductOption[];
  loading: boolean;
  error: string | null;
  isSaving: boolean;
  formError: string | null;
  lastSuccess: string | null;
  postingWarning: string | null;
  accountingNote: string | null;
  periodFrom: string;
  periodTo: string;
}

async function fetchWriteOffsState() {
  const [writeOffsResult, ingredientsResult, productsResult] =
    await Promise.all([
      writeOffService.listWriteOffs(),
      writeOffService.listIngredientOptions(),
      writeOffService.listProductOptions(),
    ]);

  return {
    writeOffs: writeOffsResult.error ? [] : (writeOffsResult.data ?? []),
    ingredients: ingredientsResult.error
      ? []
      : (ingredientsResult.data ?? []),
    products: productsResult.error ? [] : (productsResult.data ?? []),
    error:
      writeOffsResult.error ??
      ingredientsResult.error ??
      productsResult.error ??
      null,
  };
}

export function useWriteOffs() {
  const defaultPeriod = defaultWriteOffPeriod();
  const [state, setState] = useState<UseWriteOffsState>({
    writeOffs: [],
    ingredients: [],
    products: [],
    loading: true,
    error: null,
    isSaving: false,
    formError: null,
    lastSuccess: null,
    postingWarning: null,
    accountingNote: null,
    periodFrom: defaultPeriod.from,
    periodTo: defaultPeriod.to,
  });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    const next = await fetchWriteOffsState();
    setState((prev) => ({
      ...prev,
      writeOffs: next.writeOffs,
      ingredients: next.ingredients,
      products: next.products,
      error: next.error,
      loading: false,
    }));
  }, []);

  useAsyncEffect(load, [load]);

  const submitWriteOff = useCallback(async (input: RecordWriteOffInput) => {
    setState((prev) => ({
      ...prev,
      isSaving: true,
      formError: null,
      lastSuccess: null,
      postingWarning: null,
      accountingNote: null,
    }));

    const result = await writeOffAccountingService.recordWriteOffAndPost(input);

    if (result.error !== null || !result.data) {
      setState((prev) => ({
        ...prev,
        isSaving: false,
        formError: result.error ?? "Failed to record write-off.",
      }));
      return false;
    }

    const writeOffsResult = await writeOffService.listWriteOffs();

    setState((prev) => ({
      ...prev,
      isSaving: false,
      formError: null,
      lastSuccess: result.data.accountingNote
        ? null
        : "Write-off recorded.",
      postingWarning: result.data.postingError,
      accountingNote: result.data.accountingNote,
      writeOffs: writeOffsResult.error
        ? prev.writeOffs
        : (writeOffsResult.data ?? []),
    }));

    return true;
  }, []);

  const clearLastSuccess = useCallback(() => {
    setState((prev) => ({
      ...prev,
      lastSuccess: null,
      postingWarning: null,
      accountingNote: null,
    }));
  }, []);

  const setPeriodFrom = useCallback((value: string) => {
    setState((prev) => ({ ...prev, periodFrom: value }));
  }, []);

  const setPeriodTo = useCallback((value: string) => {
    setState((prev) => ({ ...prev, periodTo: value }));
  }, []);

  return {
    writeOffs: state.writeOffs,
    ingredients: state.ingredients,
    products: state.products,
    loading: state.loading,
    error: state.error,
    isSaving: state.isSaving,
    formError: state.formError,
    lastSuccess: state.lastSuccess,
    postingWarning: state.postingWarning,
    accountingNote: state.accountingNote,
    periodFrom: state.periodFrom,
    periodTo: state.periodTo,
    setPeriodFrom,
    setPeriodTo,
    submitWriteOff,
    clearLastSuccess,
    retry: load,
  };
}
