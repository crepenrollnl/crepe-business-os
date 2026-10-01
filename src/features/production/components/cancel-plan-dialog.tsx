type CancelPlanDialogProps = {
  isOpen: boolean;
  isCancelling: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => Promise<boolean>;
};

export function CancelPlanDialog({
  isOpen,
  isCancelling,
  error,
  onClose,
  onConfirm,
}: CancelPlanDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-zinc-900/50"
        onClick={isCancelling ? undefined : onClose}
        disabled={isCancelling}
      />

      <div className="relative w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-zinc-900">Cancel plan</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Cancel this plan? Stock does not change. A linked purchase draft
          stays in Purchases.
        </p>

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isCancelling}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Keep plan
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isCancelling}
            className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCancelling ? "Cancelling..." : "Cancel plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
