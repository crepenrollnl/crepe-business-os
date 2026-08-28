import Link from "next/link";
import { formatDateTime } from "@/lib/date";
import type { InventoryMovementHistory } from "../types/inventory-movement-history";
import {
  formatMovementQuantity,
  formatMovementType,
  MOVEMENT_HISTORY_STOCK_WARNING,
  movementDocumentLink,
} from "../utils/format-movement-history";

const COLUMN_COUNT = 4;

type IngredientMovementHistoryPanelProps = {
  items: InventoryMovementHistory[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
};

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-t border-zinc-200">
          {Array.from({ length: COLUMN_COUNT }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-4 py-4">
              <div className="h-4 animate-pulse rounded bg-zinc-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function DocumentCell({ item }: { item: InventoryMovementHistory }) {
  const document = movementDocumentLink(item.source_type, item.source_id);

  if (document.href) {
    return (
      <Link
        href={document.href}
        className="font-medium text-amber-700 transition-colors hover:text-amber-800"
      >
        {document.label}
      </Link>
    );
  }

  return <span>{document.label}</span>;
}

export function IngredientMovementHistoryPanel({
  items,
  loading,
  error,
  onRetry,
}: IngredientMovementHistoryPanelProps) {
  return (
    <div className="space-y-4">
      <p
        role="note"
        className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        {MOVEMENT_HISTORY_STOCK_WARNING}
      </p>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-base font-medium text-red-800">
            Failed to load movement history
          </p>
          <p className="mt-2 text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-6 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Quantity</th>
                <th className="px-4 py-3">Document</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <TableSkeleton />
              ) : items.length === 0 ? (
                <tr>
                  <td
                    colSpan={COLUMN_COUNT}
                    className="px-4 py-16 text-center"
                  >
                    <p className="text-base font-medium text-zinc-900">
                      No recorded movements for this ingredient yet.
                    </p>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr
                    key={item.movement_id}
                    className="border-t border-zinc-200 transition-colors hover:bg-zinc-50"
                  >
                    <td className="px-4 py-4 text-zinc-700">
                      {formatDateTime(item.occurred_at)}
                    </td>
                    <td className="px-4 py-4 text-zinc-900">
                      {formatMovementType(item.movement_type)}
                    </td>
                    <td className="px-4 py-4 text-right font-medium tabular-nums text-zinc-900">
                      {formatMovementQuantity(
                        item.quantity,
                        item.unit,
                        item.movement_type,
                      )}
                    </td>
                    <td className="px-4 py-4 text-zinc-700">
                      <DocumentCell item={item} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
