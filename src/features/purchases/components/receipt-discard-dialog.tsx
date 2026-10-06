"use client";

interface ReceiptDiscardDialogProps {
  open: boolean;
  isDiscarding: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function ReceiptDiscardDialog({
  open,
  isDiscarding,
  error,
  onClose,
  onConfirm,
}: ReceiptDiscardDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-4 sm:items-center">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-zinc-900/50"
        onClick={isDiscarding ? undefined : onClose}
        disabled={isDiscarding}
      />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-lg font-semibold text-zinc-900">Discard this receipt?</h2>
        <p className="mt-2 text-sm text-zinc-600">
          The photo stays in the archive and leaves the unassigned list. This
          does not delete it.
        </p>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isDiscarding}
            className="min-h-12 rounded-lg border border-zinc-300 text-base font-semibold text-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDiscarding}
            className="min-h-12 rounded-lg bg-zinc-900 text-base font-semibold text-white disabled:opacity-60"
          >
            Discard receipt
          </button>
        </div>
      </div>
    </div>
  );
}
