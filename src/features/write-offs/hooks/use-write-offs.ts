"use client";

import { useCallback, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { writeOffService } from "../services/write-off-service";
import type {
  RecordDishWriteOffInput,
  RecordWriteOffInput,
  WriteOffDishOption,
  WriteOffIngredientOption,
  WriteOffProductOption,
  WriteOffRecord,
} from "../types/write-off";
import { defaultWriteOffPeriod } from "../utils/write-off-period";

interface UseWriteOffsState {
  writeOffs: WriteOffRecord[];
  ingredients: WriteOffIngredientOption[];
  products: WriteOffProductOption[];
  dishes: WriteOffDishOption[];
  loading: boolean;
  error: string | null;
  isSaving: boolean;
  formError: string | null;
  lastSuccess: string | null;
  periodFrom: string;
  periodTo: string;
}

async function fetchWriteOffsState() {
  const [writeOffsResult, ingredientsResult, productsResult, dishesResult] =
    await Promise.all([
      writeOffService.listWriteOffs(),
      writeOffService.listIngredientOptions(),
      writeOffService.listProductOptions(),
      writeOffService.listDishOptions(),
    ]);

  return {
    writeOffs: writeOffsResult.error ? [] : (writeOffsResult.data ?? []),
    ingredients: ingredientsResult.error
      ? []
      : (ingredientsResult.data ?? []),
    products: productsResult.error ? [] : (productsResult.data ?? []),
    dishes: dishesResult.error ? [] : (dishesResult.data ?? []),
    error:
      writeOffsResult.error ??
      ingredientsResult.error ??
      productsResult.error ??
      dishesResult.error ??
      null,
  };
}

export function useWriteOffs() {
  const defaultPeriod = defaultWriteOffPeriod();
  const [state, setState] = useState<UseWriteOffsState>({
    writeOffs: [],
    ingredients: [],
    products: [],
    dishes: [],
    loading: true,
    error: null,
    isSaving: false,
    formError: null,
    lastSuccess: null,
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
      dishes: next.dishes,
      error: next.error,
      loading: false,
    }));
  }, []);

  useAsyncEffect(load, [load]);

  // Recording is the RPC only: the database posts the waste journal at
  // COMMIT (sql/148, audit D2/K3).
  const submitWriteOff = useCallback(async (input: RecordWriteOffInput) => {
    setState((prev) => ({
      ...prev,
      isSaving: true,
      formError: null,
      lastSuccess: null,
    }));

    const result = await writeOffService.recordWriteOff(input);

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
      lastSuccess: "Write-off recorded.",
      writeOffs: writeOffsResult.error
        ? prev.writeOffs
        : (writeOffsResult.data ?? []),
    }));

    return true;
  }, []);

  const submitDishWriteOff = useCallback(
    async (input: RecordDishWriteOffInput) => {
      setState((prev) => ({
        ...prev,
        isSaving: true,
        formError: null,
        lastSuccess: null,
      }));

      const result = await writeOffService.recordDishWriteOff(input);

      if (result.error !== null || !result.data) {
        setState((prev) => ({
          ...prev,
          isSaving: false,
          formError: result.error ?? "Failed to record dish write-off.",
        }));
        return false;
      }

      const writeOffsResult = await writeOffService.listWriteOffs();
      const dishWriteOff = result.data;

      setState((prev) => ({
        ...prev,
        isSaving: false,
        formError: null,
        lastSuccess: `Dish write-off recorded: ${dishWriteOff.write_offs.length} items written off.`,
        writeOffs: writeOffsResult.error
          ? prev.writeOffs
          : (writeOffsResult.data ?? []),
      }));

      return true;
    },
    [],
  );

  const clearLastSuccess = useCallback(() => {
    setState((prev) => ({
      ...prev,
      lastSuccess: null,
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
    dishes: state.dishes,
    loading: state.loading,
    error: state.error,
    isSaving: state.isSaving,
    formError: state.formError,
    lastSuccess: state.lastSuccess,
    periodFrom: state.periodFrom,
    periodTo: state.periodTo,
    setPeriodFrom,
    setPeriodTo,
    submitWriteOff,
    submitDishWriteOff,
    clearLastSuccess,
    retry: load,
  };
}
