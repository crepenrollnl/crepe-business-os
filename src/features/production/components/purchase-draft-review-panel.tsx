import type {
  CalculatedPurchaseDraftReviewLine,
  CalculatedPurchaseDraftReviewSummary,
  ProductionPlanLinkedPurchase,
  PurchaseDraftLinkStatus,
} from "../types/production";
import { formatQuantity } from "../utils/format-quantity";

type PurchaseDraftReviewPanelProps = {
  lines: CalculatedPurchaseDraftReviewLine[];
  summary: CalculatedPurchaseDraftReviewSummary;
  transferStatus: PurchaseDraftLinkStatus;
  linkedPurchase: ProductionPlanLinkedPurchase | null;
  isTransferring: boolean;
  transferError: string | null;
  disabled: boolean;
  onSendToPurchases: () => void;
};

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-1 text-sm font-semibold text-zinc-900">{value}</p>
    </div>
  );
}

export function PurchaseDraftReviewPanel({
  lines,
  summary,
  transferStatus,
  linkedPurchase,
  isTransferring,
  transferError,
  disabled,
  onSendToPurchases,
}: PurchaseDraftReviewPanelProps) {
  const alreadyTransferred = transferStatus !== "not_created";
  const canSend =
    !disabled &&
    !alreadyTransferred &&
    !isTransferring &&
    lines.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryStat label="Items" value={String(summary.items)} />
          <SummaryStat label="Packages" value={String(summary.packages)} />
          <SummaryStat
            label="Total Purchase Quantity"
            value={formatQuantity(summary.total_purchase_quantity)}
          />
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
          {alreadyTransferred && linkedPurchase ? (
            <a
              href={`/purchases?open=${linkedPurchase.id}`}
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
            >
              Open Purchase Draft
            </a>
          ) : (
            <button
              type="button"
              onClick={onSendToPurchases}
              disabled={!canSend}
              className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isTransferring ? "Sending..." : "Send to Purchases"}
            </button>
          )}
          {alreadyTransferred ? (
            <p className="text-sm font-medium text-amber-700">
              Already transferred.
            </p>
          ) : null}
        </div>
      </div>

      {transferError ? (
        <div className="mx-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-sm text-red-700">{transferError}</p>
        </div>
      ) : null}

      {lines.length === 0 ? (
        <div className="px-4 pb-6 text-center">
          <p className="text-sm text-zinc-500">
            No purchases are required. Nothing to transfer.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <table className="min-w-full">
            <thead className="bg-zinc-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Supplier
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Ingredient
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                  Quantity
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                  Packages
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Reason
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((row) => (
                <tr
                  key={row.ingredient_id}
                  className="border-t border-zinc-200 bg-white"
                >
                  <td className="px-4 py-3 text-sm text-zinc-600">
                    {row.supplier_name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-zinc-900">
                    {row.ingredient_name}
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      {row.unit}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-zinc-700">
                    {formatQuantity(row.quantity)}
                  </td>
                  <td className="px-4 py-3 text-right text-sm text-zinc-700">
                    {row.packages}
                  </td>
                  <td className="px-4 py-3 text-sm text-zinc-600">{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
