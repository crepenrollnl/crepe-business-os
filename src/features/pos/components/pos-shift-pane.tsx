"use client";

import { ShiftStatusPanel } from "@/components/shift-status-panel";
import { usePosShift } from "../hooks/use-pos-shift";

export function PosShiftPane() {
  const {
    activeShift,
    closedShift,
    reconciliation,
    loading,
    mutating,
    error,
    actionError,
    openShift,
    closeShift,
    reconcileCash,
    retry,
  } = usePosShift();

  return (
    <div className="mx-auto max-w-3xl">
      <ShiftStatusPanel
        activeShift={activeShift}
        closedShift={closedShift}
        reconciliation={reconciliation}
        loading={loading}
        mutating={mutating}
        error={error}
        actionError={actionError}
        onOpenShift={() => {
          void openShift();
        }}
        onCloseShift={() => {
          void closeShift();
        }}
        onReconcileCash={(countedCash) => {
          void reconcileCash(countedCash);
        }}
        onRetry={() => {
          void retry();
        }}
      />
    </div>
  );
}
