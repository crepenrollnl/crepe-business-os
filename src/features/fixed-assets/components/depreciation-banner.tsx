import { formatDepreciationPeriods } from "../utils/format-depreciation-summary";
import type { RunDepreciationResult } from "../types/fixed-asset";

interface DepreciationBannerProps {
  result: RunDepreciationResult;
  onDismiss: () => void;
}

export function DepreciationBanner({ result, onDismiss }: DepreciationBannerProps) {
  const periods = formatDepreciationPeriods(result.details);
  const entryWord = result.entriesCreated === 1 ? "period" : "periods";

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
    >
      <span>
        Depreciation posted for {result.entriesCreated} {entryWord}: {periods},
        total €{result.totalAmount.toFixed(2)}.
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="text-emerald-700 underline hover:text-emerald-900"
      >
        Dismiss
      </button>
    </div>
  );
}
