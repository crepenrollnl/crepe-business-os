import type { IngredientWithRelations } from "../types/inventory";

type DeleteDialogProps = {
  item: IngredientWithRelations | null;
  isDeleting: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => Promise<boolean>;
};

export function DeleteDialog({
  item,
  isDeleting,
  error,
  onClose,
  onConfirm,
}: DeleteDialogProps) {
  if (!item) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-zinc-900/50"
        onClick={isDeleting ? undefined : onClose}
        disabled={isDeleting}
      />

      <div className="relative w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-zinc-900">Delete ingredient</h2>
        <p className="mt-2 text-sm text-zinc-600">
          Are you sure you want to delete{" "}
          <span className="font-medium text-zinc-900">{item.name}</span>? This action
          cannot be undone.
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
            disabled={isDeleting}
            className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={isDeleting}
            className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
