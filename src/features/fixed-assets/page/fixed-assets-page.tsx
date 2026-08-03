"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DepreciationBanner } from "../components/depreciation-banner";
import { DepreciationWarningBanner } from "../components/depreciation-warning-banner";
import { FixedAssetForm } from "../components/fixed-asset-form";
import { FixedAssetList } from "../components/fixed-asset-list";
import { useFixedAssets } from "../hooks/use-fixed-assets";

export function FixedAssetsPage() {
  const {
    assets,
    loading,
    error,
    isSaving,
    formError,
    depreciationBanner,
    depreciationWarning,
    submitAsset,
    dismissDepreciationBanner,
    dismissDepreciationWarning,
    retry,
  } = useFixedAssets();

  return (
    <DashboardLayout activePath="/fixed-assets">
      <div className="mx-auto max-w-4xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Fixed Assets
          </h1>
          <p className="mt-2 text-base text-zinc-600 sm:text-lg">
            Register assets and track their straight-line monthly depreciation.
          </p>
        </div>

        {depreciationBanner && (
          <DepreciationBanner
            result={depreciationBanner}
            onDismiss={dismissDepreciationBanner}
          />
        )}

        {depreciationWarning && (
          <DepreciationWarningBanner
            message={depreciationWarning}
            onDismiss={dismissDepreciationWarning}
          />
        )}

        <FixedAssetForm isSaving={isSaving} error={formError} onSubmit={submitAsset} />

        <FixedAssetList
          assets={assets}
          loading={loading}
          error={error}
          onRetry={retry}
        />
      </div>
    </DashboardLayout>
  );
}
