"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { WriteOffForm } from "../components/write-off-form";
import { WriteOffList } from "../components/write-off-list";
import { WriteOffTotals } from "../components/write-off-totals";
import { useWriteOffs } from "../hooks/use-write-offs";
import type { WriteOffItemType } from "../types/write-off";

type WriteOffsPageProps = {
  /** Skip DashboardLayout when composed under Inventory workspace tabs. */
  embedded?: boolean;
  prefillItemType?: WriteOffItemType | null;
  prefillItemId?: string | null;
};

export function WriteOffsPage({
  embedded = false,
  prefillItemType = null,
  prefillItemId = null,
}: WriteOffsPageProps) {
  const {
    writeOffs,
    ingredients,
    products,
    loading,
    error,
    isSaving,
    formError,
    lastSuccess,
    postingWarning,
    accountingNote,
    periodFrom,
    periodTo,
    setPeriodFrom,
    setPeriodTo,
    submitWriteOff,
    clearLastSuccess,
    retry,
  } = useWriteOffs();

  const content = (
    <div className="mx-auto max-w-4xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
          Write-offs
        </h1>
        <p className="mt-2 text-base text-zinc-600 sm:text-lg">
          Record spoilage, damage, and other stock losses for raw materials
          and finished goods.
        </p>
      </div>

      <WriteOffForm
        ingredients={ingredients}
        products={products}
        isSaving={isSaving}
        error={formError}
        lastSuccess={lastSuccess}
        postingWarning={postingWarning}
        accountingNote={accountingNote}
        prefillItemType={prefillItemType}
        prefillItemId={prefillItemId}
        onSubmit={submitWriteOff}
        onDismissSuccess={clearLastSuccess}
      />

      <WriteOffTotals
        writeOffs={writeOffs}
        periodFrom={periodFrom}
        periodTo={periodTo}
        onPeriodFromChange={setPeriodFrom}
        onPeriodToChange={setPeriodTo}
      />

      <WriteOffList
        writeOffs={writeOffs}
        periodFrom={periodFrom}
        periodTo={periodTo}
        loading={loading}
        error={error}
        onRetry={retry}
      />
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <DashboardLayout activePath="/inventory">{content}</DashboardLayout>
  );
}
