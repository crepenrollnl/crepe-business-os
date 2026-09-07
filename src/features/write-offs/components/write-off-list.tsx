import { formatDate } from "@/lib/date";
import { formatMoney } from "@/lib/money";
import {
  WRITE_OFF_REASON_LABELS,
  type WriteOffRecord,
} from "../types/write-off";
import { isWriteOffInPeriod } from "../utils/write-off-period";

interface WriteOffListProps {
  writeOffs: WriteOffRecord[];
  periodFrom: string;
  periodTo: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function WriteOffListSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-t border-zinc-200">
          {Array.from({ length: 5 }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-4 py-4">
              <div className="h-4 animate-pulse rounded bg-zinc-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function WriteOffListEmptyState() {
  return (
    <tr>
      <td colSpan={5} className="px-4 py-16 text-center">
        <p className="text-base font-medium text-zinc-900">No write-offs yet</p>
        <p className="mt-2 text-sm text-zinc-500">
          Write-offs you record above will appear here.
        </p>
      </td>
    </tr>
  );
}

function WriteOffRow({ writeOff }: { writeOff: WriteOffRecord }) {
  return (
    <tr className="border-t border-zinc-200">
      <td className="px-4 py-4 text-sm text-zinc-700">
        {formatDate(writeOff.created_at)}
      </td>
      <td className="px-4 py-4 text-sm text-zinc-900">
        {writeOff.item_name ?? "—"}
      </td>
      <td className="px-4 py-4 text-right text-sm text-zinc-700">
        {writeOff.quantity}
      </td>
      <td className="px-4 py-4 text-sm text-zinc-700">
        {WRITE_OFF_REASON_LABELS[writeOff.reason]}
      </td>
      <td className="px-4 py-4 text-right text-sm font-medium text-zinc-900">
        {formatMoney(writeOff.total_value)}
      </td>
    </tr>
  );
}

export function WriteOffList({
  writeOffs,
  periodFrom,
  periodTo,
  loading,
  error,
  onRetry,
}: WriteOffListProps) {
  const visible = writeOffs.filter((row) =>
    isWriteOffInPeriod(row.created_at, periodFrom, periodTo),
  );

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-base font-medium text-red-800">
          Failed to load write-offs
        </p>
        <p className="mt-2 text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                Date
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                Item
              </th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                Quantity
              </th>
              <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                Reason
              </th>
              <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <WriteOffListSkeleton />
            ) : visible.length === 0 ? (
              <WriteOffListEmptyState />
            ) : (
              visible.map((writeOff) => (
                <WriteOffRow key={writeOff.id} writeOff={writeOff} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
