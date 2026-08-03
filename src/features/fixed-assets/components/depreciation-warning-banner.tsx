interface DepreciationWarningBannerProps {
  message: string;
  onDismiss: () => void;
}

/**
 * Non-blocking warning shown when run_pending_depreciation itself failed
 * (e.g. a misconfigured account) -- separate from the list's own error
 * state, since the asset list can load and render normally on its own even
 * when the catch-up run did not.
 */
export function DepreciationWarningBanner({
  message,
  onDismiss,
}: DepreciationWarningBannerProps) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
    >
      <span>Depreciation catch-up did not run: {message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-amber-800 underline hover:text-amber-900"
      >
        Dismiss
      </button>
    </div>
  );
}
