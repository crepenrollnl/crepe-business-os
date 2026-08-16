"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { ProductionSessionBatchesSection } from "../components/production-session-batches-section";
import { ProductionSessionHeader } from "../components/production-session-header";
import { ProductionSessionLinesSection } from "../components/production-session-lines-section";
import { useProductionSession } from "../hooks/use-production-session";

type ProductionSessionPageProps = {
  sessionId: string;
};

export function ProductionSessionPage({ sessionId }: ProductionSessionPageProps) {
  const {
    session,
    loading,
    error,
    notes,
    drafts,
    rawMaterialScaleDrafts,
    canEdit,
    canFinish,
    saving,
    finishing,
    actionError,
    onNotesChange,
    onProducedChange,
    onRawMaterialScaleChange,
    saveProgress,
    finishProduction,
    retry,
  } = useProductionSession(sessionId);

  return (
    <DashboardLayout activePath="/production-execution">
      <div className="mx-auto max-w-7xl space-y-8">
        {loading ? (
          <div className="space-y-6">
            <div className="h-10 w-72 animate-pulse rounded-lg bg-zinc-100" />
            <div className="h-24 animate-pulse rounded-xl bg-zinc-100" />
            <div className="h-64 animate-pulse rounded-xl bg-zinc-100" />
          </div>
        ) : error || !session ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <p className="text-base font-medium text-red-800">
              Failed to load production session
            </p>
            <p className="mt-2 text-sm text-red-600">
              {error ?? "Production session was not found."}
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-6 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            <ProductionSessionHeader
              session={session}
              notes={notes}
              canEdit={canEdit}
              canFinish={canFinish}
              finishing={finishing}
              saving={saving}
              actionError={actionError}
              onNotesChange={onNotesChange}
              onSaveProgress={() => {
                void saveProgress();
              }}
              onFinish={() => {
                void finishProduction();
              }}
            />
            <ProductionSessionLinesSection
              lines={session.lines}
              drafts={drafts}
              rawMaterialScaleDrafts={rawMaterialScaleDrafts}
              canEdit={canEdit}
              onProducedChange={onProducedChange}
              onRawMaterialScaleChange={onRawMaterialScaleChange}
            />
            {session.status === "completed" ? (
              <>
                <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-4 text-sm text-green-800">
                  Production session completed. Raw materials were consumed,
                  production batches were created, and finished goods are now
                  available for sales.
                </div>
                <ProductionSessionBatchesSection
                  batches={session.batches ?? []}
                  completionDate={session.completed_at}
                  accountingPostingStatus={
                    session.accounting_posting_status ?? "pending"
                  }
                />
              </>
            ) : null}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
