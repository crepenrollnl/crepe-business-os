import { formatSaleMoney } from "../utils/format-sale";
import type { QuickSaleCartLine } from "../hooks/use-quick-sale";

type QuickSaleCartProps = {
  lines: QuickSaleCartLine[];
  subtotal: number;
  confirming: boolean;
  actionError: string | null;
  postingError: string | null;
  lastConfirmedSaleNumber: string | null;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onConfirm: () => void;
};

export function QuickSaleCart({
  lines,
  subtotal,
  confirming,
  actionError,
  postingError,
  lastConfirmedSaleNumber,
  onIncrement,
  onDecrement,
  onConfirm,
}: QuickSaleCartProps) {
  return (
    <div className="flex h-fit flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-zinc-900">Cart</h2>

      {lastConfirmedSaleNumber ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          Sale {lastConfirmedSaleNumber} confirmed.
        </div>
      ) : null}

      {postingError ? (
        <p className="text-sm text-amber-700">{postingError}</p>
      ) : null}

      {lines.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Tap a product to add it to the cart.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {lines.map((line) => (
            <li
              key={line.product_id}
              className="flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900">
                  {line.name}
                </p>
                <p className="text-xs text-zinc-500">
                  {formatSaleMoney(line.unit_price)} each
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onDecrement(line.product_id)}
                  aria-label={`Remove one ${line.name}`}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-300 text-lg text-zinc-600 transition-colors hover:bg-zinc-50"
                >
                  −
                </button>
                <span className="w-8 text-center text-base font-medium text-zinc-900">
                  {line.quantity}
                </span>
                <button
                  type="button"
                  onClick={() => onIncrement(line.product_id)}
                  aria-label={`Add one ${line.name}`}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-300 text-lg text-zinc-600 transition-colors hover:bg-zinc-50"
                >
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between border-t border-zinc-200 pt-3">
        <span className="text-sm font-medium text-zinc-700">Subtotal</span>
        <span className="text-lg font-semibold text-zinc-900">
          {formatSaleMoney(subtotal)}
        </span>
      </div>

      {actionError ? (
        <p className="text-sm text-red-600" role="alert">
          {actionError}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onConfirm}
        disabled={lines.length === 0 || confirming}
        className="min-h-12 w-full rounded-lg bg-amber-500 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {confirming ? "Confirming..." : "Confirm"}
      </button>
    </div>
  );
}
