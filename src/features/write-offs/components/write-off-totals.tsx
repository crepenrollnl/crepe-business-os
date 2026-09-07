import { formatMoney } from "@/lib/money";
import {
  WRITE_OFF_REASON_LABELS,
  WRITE_OFF_REASONS,
  type WriteOffRecord,
} from "../types/write-off";
import { summarizeWriteOffs } from "../utils/write-off-period";

interface WriteOffTotalsProps {
  writeOffs: WriteOffRecord[];
  periodFrom: string;
  periodTo: string;
  onPeriodFromChange: (value: string) => void;
  onPeriodToChange: (value: string) => void;
}

const inputClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20";

export function WriteOffTotals({
  writeOffs,
  periodFrom,
  periodTo,
  onPeriodFromChange,
  onPeriodToChange,
}: WriteOffTotalsProps) {
  const totals = summarizeWriteOffs(writeOffs, periodFrom, periodTo);
  const reasonsWithValue = WRITE_OFF_REASONS.filter(
    (reason) => totals.byReason[reason] > 0,
  );

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">Period totals</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Defaults to this calendar month. Change the range to compare
            another period.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:w-80">
          <div className="space-y-1">
            <label htmlFor="writeOffPeriodFrom" className="text-sm font-medium text-zinc-700">
              From
            </label>
            <input
              id="writeOffPeriodFrom"
              type="date"
              value={periodFrom}
              onChange={(event) => onPeriodFromChange(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="writeOffPeriodTo" className="text-sm font-medium text-zinc-700">
              To
            </label>
            <input
              id="writeOffPeriodTo"
              type="date"
              value={periodTo}
              onChange={(event) => onPeriodToChange(event.target.value)}
              className={inputClassName}
            />
          </div>
        </div>
      </div>

      <p className="mt-6 text-2xl font-semibold tracking-tight text-zinc-900">
        {formatMoney(totals.totalValue)}
      </p>
      <p className="mt-1 text-sm text-zinc-500">Total write-offs in this period</p>

      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        {(reasonsWithValue.length > 0 ? reasonsWithValue : WRITE_OFF_REASONS).map(
          (reason) => (
            <div
              key={reason}
              className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm"
            >
              <dt className="text-zinc-600">{WRITE_OFF_REASON_LABELS[reason]}</dt>
              <dd className="font-medium text-zinc-900">
                {formatMoney(totals.byReason[reason])}
              </dd>
            </div>
          ),
        )}
      </dl>
    </div>
  );
}
