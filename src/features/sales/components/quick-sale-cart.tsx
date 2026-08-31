import { formatSaleMoney } from "../utils/format-sale";
import type { SaleDiscountType } from "../types/sale";
import type { QuickSaleCartLine } from "../hooks/use-quick-sale";

type QuickSaleCartSharedProps = {
  lines: QuickSaleCartLine[];
  confirming: boolean;
  actionError: string | null;
  postingError: string | null;
  lastConfirmedSaleNumber: string | null;
  sendToQueue: boolean;
  kitchenNote: string;
  onSendToQueueChange: (value: boolean) => void;
  onKitchenNoteChange: (value: string) => void;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onConfirm: () => void;
};

/** Quick Sale: Items → Discount → To pay. */
type QuickSaleCartDiscountProps = QuickSaleCartSharedProps & {
  itemsTotal: number;
  discountType: SaleDiscountType;
  discountInput: string;
  discountAmount: number;
  payable: number;
  discountError: string | null;
  onDiscountTypeChange: (value: SaleDiscountType) => void;
  onDiscountInputChange: (value: string) => void;
  subtotal?: never;
};

/** POS reuses this cart unchanged: catalog total labeled Subtotal. */
type QuickSaleCartPosProps = QuickSaleCartSharedProps & {
  subtotal: number;
  itemsTotal?: never;
  discountType?: never;
  discountInput?: never;
  discountAmount?: never;
  payable?: never;
  discountError?: never;
  onDiscountTypeChange?: never;
  onDiscountInputChange?: never;
};

type QuickSaleCartProps = QuickSaleCartDiscountProps | QuickSaleCartPosProps;

function typeClassName(isActive: boolean): string {
  return `rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
    isActive
      ? "bg-white text-zinc-900 shadow-sm"
      : "text-zinc-600 hover:text-zinc-900"
  }`;
}

export function QuickSaleCart({
  lines,
  subtotal,
  itemsTotal,
  discountType,
  discountInput,
  discountAmount,
  payable,
  discountError,
  confirming,
  actionError,
  postingError,
  lastConfirmedSaleNumber,
  sendToQueue,
  kitchenNote,
  onDiscountTypeChange,
  onDiscountInputChange,
  onSendToQueueChange,
  onKitchenNoteChange,
  onIncrement,
  onDecrement,
  onConfirm,
}: QuickSaleCartProps) {
  const showDiscount = onDiscountTypeChange !== undefined;

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

      {showDiscount &&
      itemsTotal !== undefined &&
      discountType !== undefined &&
      discountInput !== undefined &&
      discountAmount !== undefined &&
      payable !== undefined &&
      onDiscountInputChange !== undefined ? (
        <div className="space-y-2 border-t border-zinc-200 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-700">Items</span>
            <span className="text-sm font-medium text-zinc-900">
              {formatSaleMoney(itemsTotal)}
            </span>
          </div>

          <div className="space-y-2">
            <span className="text-sm font-medium text-zinc-700">Discount</span>
            <div className="inline-flex items-center gap-1 rounded-xl bg-zinc-100 p-1">
              <button
                type="button"
                className={typeClassName(discountType === "percent")}
                disabled={confirming}
                onClick={() => onDiscountTypeChange("percent")}
              >
                %
              </button>
              <button
                type="button"
                className={typeClassName(discountType === "amount")}
                disabled={confirming}
                onClick={() => onDiscountTypeChange("amount")}
              >
                €
              </button>
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={discountInput}
              disabled={confirming || lines.length === 0}
              placeholder={discountType === "percent" ? "0" : "0.00"}
              onChange={(event) => onDiscountInputChange(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:cursor-not-allowed disabled:bg-zinc-50"
            />
          </div>

          {discountAmount > 0 ? (
            <div className="flex items-center justify-between text-sm text-zinc-600">
              <span>Discount</span>
              <span>−{formatSaleMoney(discountAmount)}</span>
            </div>
          ) : null}

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-700">To pay</span>
            <span className="text-lg font-semibold text-zinc-900">
              {formatSaleMoney(payable)}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between border-t border-zinc-200 pt-3">
          <span className="text-sm font-medium text-zinc-700">Subtotal</span>
          <span className="text-lg font-semibold text-zinc-900">
            {formatSaleMoney(subtotal ?? 0)}
          </span>
        </div>
      )}

      {discountError ? (
        <p className="text-sm text-red-600" role="alert">
          {discountError}
        </p>
      ) : null}

      {actionError ? (
        <p className="text-sm text-red-600" role="alert">
          {actionError}
        </p>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm text-zinc-700">
        <span>Kitchen note</span>
        <textarea
          value={kitchenNote}
          disabled={confirming}
          rows={2}
          onChange={(event) => onKitchenNoteChange(event.target.value)}
          placeholder="Allergy, extra sauce, no onions…"
          className="min-h-16 w-full resize-y rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:cursor-not-allowed disabled:bg-zinc-50"
        />
      </label>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-zinc-700">
        <input
          type="checkbox"
          checked={sendToQueue}
          disabled={confirming}
          onChange={(event) => onSendToQueueChange(event.target.checked)}
          className="h-5 w-5 rounded border-zinc-300 text-amber-500 focus:ring-amber-500/30"
        />
        Send to queue
      </label>

      <button
        type="button"
        onClick={onConfirm}
        disabled={
          lines.length === 0 ||
          confirming ||
          (showDiscount && discountError != null)
        }
        className="min-h-12 w-full rounded-lg bg-amber-500 px-4 py-3 text-base font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {confirming ? "Confirming..." : "Confirm"}
      </button>
    </div>
  );
}
