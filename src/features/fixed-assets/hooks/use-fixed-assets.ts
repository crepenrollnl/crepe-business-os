"use client";

import { useCallback, useEffect, useState } from "react";
import { fixedAssetService } from "../services/fixed-asset-service";
import type {
  FixedAssetWithDepreciation,
  RegisterFixedAssetInput,
  RunDepreciationResult,
} from "../types/fixed-asset";

interface UseFixedAssetsState {
  assets: FixedAssetWithDepreciation[];
  loading: boolean;
  error: string | null;
  isSaving: boolean;
  formError: string | null;
  depreciationBanner: RunDepreciationResult | null;
  depreciationWarning: string | null;
}

interface DepreciationAndAssetsResult {
  assets: FixedAssetWithDepreciation[];
  assetsError: string | null;
  depreciationBanner: RunDepreciationResult | null;
  depreciationWarning: string | null;
}

/**
 * Catch up missed months, then load the list -- shared by the initial page
 * load and by submitAsset (a freshly registered asset with a historical
 * purchase_date should show its already-elapsed depreciation immediately,
 * not just after the next page visit).
 *
 * The two calls are kept independent: a runPendingDepreciation failure
 * (e.g. a misconfigured account) must never block the asset list, which
 * can load and render successfully on its own -- reported separately via
 * depreciationWarning instead of the blocking `error` field.
 */
async function runDepreciationAndLoadAssets(): Promise<DepreciationAndAssetsResult> {
  const depreciationResult = await fixedAssetService.runPendingDepreciation();
  const assetsResult = await fixedAssetService.listFixedAssets();

  return {
    assets: assetsResult.error ? [] : (assetsResult.data ?? []),
    assetsError: assetsResult.error,
    depreciationBanner:
      depreciationResult.error === null && depreciationResult.data.entriesCreated > 0
        ? depreciationResult.data
        : null,
    depreciationWarning: depreciationResult.error,
  };
}

export function useFixedAssets() {
  const [state, setState] = useState<UseFixedAssetsState>({
    assets: [],
    loading: true,
    error: null,
    isSaving: false,
    formError: null,
    depreciationBanner: null,
    depreciationWarning: null,
  });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    const result = await runDepreciationAndLoadAssets();

    setState((prev) => ({
      ...prev,
      assets: result.assets,
      error: result.assetsError,
      depreciationBanner: result.depreciationBanner,
      depreciationWarning: result.depreciationWarning,
      loading: false,
    }));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitAsset = useCallback(async (input: RegisterFixedAssetInput) => {
    setState((prev) => ({ ...prev, isSaving: true, formError: null }));

    const result = await fixedAssetService.registerFixedAsset(input);

    if (result.error !== null) {
      setState((prev) => ({
        ...prev,
        isSaving: false,
        formError: result.error,
      }));
      return false;
    }

    // Catch up depreciation for the newly registered asset (its
    // purchase_date is almost always in the past) before reloading the
    // list, so remaining_value is correct immediately -- same helper used
    // on page load, not a separate code path.
    const depreciationAndAssets = await runDepreciationAndLoadAssets();

    setState((prev) => ({
      ...prev,
      isSaving: false,
      formError: null,
      assets: depreciationAndAssets.assets,
      error: depreciationAndAssets.assetsError,
      depreciationBanner: depreciationAndAssets.depreciationBanner,
      depreciationWarning: depreciationAndAssets.depreciationWarning,
    }));

    return true;
  }, []);

  const dismissDepreciationBanner = useCallback(() => {
    setState((prev) => ({ ...prev, depreciationBanner: null }));
  }, []);

  const dismissDepreciationWarning = useCallback(() => {
    setState((prev) => ({ ...prev, depreciationWarning: null }));
  }, []);

  return {
    assets: state.assets,
    loading: state.loading,
    error: state.error,
    isSaving: state.isSaving,
    formError: state.formError,
    depreciationBanner: state.depreciationBanner,
    depreciationWarning: state.depreciationWarning,
    submitAsset,
    dismissDepreciationBanner,
    dismissDepreciationWarning,
    retry: load,
  };
}
