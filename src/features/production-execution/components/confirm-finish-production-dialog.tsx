type ConfirmFinishProductionDialogProps = {
  isOpen: boolean;
  sessionNumber: string | number;
  finishing: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => Promise<boolean>;
};

export function ConfirmFinishProductionDialog({
  isOpen,
  sessionNumber,
  finishing,
  error,
  onClose,
  onConfirm,
}: ConfirmFinishProductionDialogProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-zinc-900/50"
        onClick={finishing ? undefined : onClose}
        disabled={finishing}
      />

      <div className="relative w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-zinc-900">
          Finish production
        </h2>
        <p className="mt-2 text-sm text-zinc-600">
          Finish Production Session{" "}
          <span className="font-medium text-zinc-900">
            #{sessionNumber}
          </span>
          ? This locks in the produced quantities and creates production
          batches. This action cannot be undone from the production UI.
        </p>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={finishing}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void onConfirm();
            }}
            disabled={finishing}
            className="rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {finishing ? "Finishing..." : "Finish Production"}
          </button>
        </div>
      </div>
    </div>
  );
}
