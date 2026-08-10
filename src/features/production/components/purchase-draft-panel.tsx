import type {
  ProductionPlanLinkedPurchase,
  PurchaseDraftLinkStatus,
} from "../types/production";

type PurchaseDraftPanelProps = {
  status: PurchaseDraftLinkStatus;
  purchase: ProductionPlanLinkedPurchase | null;
  planNumber: number;
  shoppingListReady: boolean;
  shoppingListEmpty: boolean;
  isGenerating: boolean;
  disabled: boolean;
  onGenerate: () => void;
};

function formatPurchaseDraftStatus(status: PurchaseDraftLinkStatus): string {
  switch (status) {
    case "draft_created":
      return "Draft Created";
    case "completed":
      return "Completed";
    default:
      return "Not Created";
  }
}

export function PurchaseDraftPanel({
  status,
  purchase,
  planNumber,
  shoppingListReady,
  shoppingListEmpty,
  isGenerating,
  disabled,
  onGenerate,
}: PurchaseDraftPanelProps) {
  const canGenerate =
    !disabled &&
    status === "not_created" &&
    shoppingListReady &&
    !shoppingListEmpty;

  return (
    <div className="rounded-xl border border-zinc-200">
      <div className="flex flex-col gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-900">Purchase Draft</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Creates a draft in Purchases from the shopping list. Supplier and
            prices are completed there.
          </p>
        </div>
        {status === "not_created" ? (
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate || isGenerating}
            className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? "Generating..." : "Generate Purchase Draft"}
          </button>
        ) : purchase ? (
          <a
            href={`/purchases?open=${purchase.id}`}
            className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Open Purchase Draft
          </a>
        ) : null}
      </div>

      <div className="space-y-2 px-4 py-4 text-sm">
        <p className="text-zinc-700">
          <span className="font-medium text-zinc-900">Status:</span>{" "}
          {formatPurchaseDraftStatus(status)}
        </p>
        <p className="text-zinc-700">
          <span className="font-medium text-zinc-900">Production Plan:</span> #
          {planNumber}
        </p>
        {purchase && (
          <p className="text-zinc-700">
            <span className="font-medium text-zinc-900">Purchase:</span>{" "}
            {purchase.invoice_number
              ? purchase.invoice_number
              : `Draft ${purchase.id.slice(0, 8)}`}{" "}
            ({purchase.status})
          </p>
        )}
        {status !== "not_created" && (
          <p className="text-amber-700">Already transferred.</p>
        )}
        {status === "not_created" && !shoppingListReady && (
          <p className="text-zinc-500">
            Generate a Shopping List before creating a Purchase Draft.
          </p>
        )}
        {status === "not_created" &&
          shoppingListReady &&
          shoppingListEmpty && (
            <p className="text-zinc-500">
              Shopping List is empty. No purchase draft is needed.
            </p>
          )}
      </div>
    </div>
  );
}
