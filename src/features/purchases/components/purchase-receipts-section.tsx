"use client";

import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { useCanManagePurchaseReceipts } from "../hooks/use-can-manage-purchase-receipts";
import { usePurchaseReceiptLinks } from "../hooks/use-purchase-receipt-links";
import type { PurchaseReceiptCard } from "../types/purchase-receipt";
import type { PurchaseStatus } from "../types/purchase";
import {
  formatReceiptDisplayDate,
  linkedReceiptTotalMessage,
} from "../utils/receipt-purchase-link";
import { ReceiptViewer } from "./receipt-viewer";

interface PurchaseReceiptsSectionProps {
  purchaseId: string | null;
  status: PurchaseStatus;
  supplierId: string | null;
  purchasedAt: string;
  grandTotal: number;
}

function pageCountLabel(count: number): string {
  return count === 1 ? "1 page" : `${count} pages`;
}

function ReceiptSummary({ receipt }: { receipt: PurchaseReceiptCard }) {
  return (
    <span className="flex w-full gap-3 text-left">
      {receipt.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- private signed URL, not a static asset
        <img
          src={receipt.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-20 w-16 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-xs text-zinc-500">
          No photo
        </span>
      )}
      <span className="min-w-0 space-y-1">
        <span className="block text-base font-semibold text-zinc-900">
          {formatReceiptDisplayDate(receipt.receiptDate)}
        </span>
        <span className="block truncate text-sm text-zinc-600">
          {receipt.supplierName ?? "No supplier"}
        </span>
        <span className="block text-sm text-zinc-800">
          {receipt.receiptTotal === null ? "No total" : formatMoney(receipt.receiptTotal)}
        </span>
        <span className="block text-sm text-zinc-500">{pageCountLabel(receipt.pageCount)}</span>
      </span>
    </span>
  );
}

export function PurchaseReceiptsSection({
  purchaseId,
  status,
  supplierId,
  purchasedAt,
  grandTotal,
}: PurchaseReceiptsSectionProps) {
  const access = useCanManagePurchaseReceipts();
  const allowed = access.status === "allowed";
  const state = usePurchaseReceiptLinks({
    enabled: allowed && purchaseId !== null,
    purchaseId,
    supplierId,
    purchasedAt,
  });

  if (!allowed) {
    return null;
  }

  if (!purchaseId) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
        <p className="text-sm text-zinc-700">Save the draft to attach a receipt.</p>
      </section>
    );
  }

  const canAttach = status === "draft" || status === "received";
  const canUnlink = status === "draft" || status === "received";
  const totalMessage = linkedReceiptTotalMessage(state.linked, grandTotal);

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-900">Receipts</h3>
        {canAttach ? (
          <button
            type="button"
            onClick={state.openPicker}
            disabled={state.isWorking}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
          >
            Attach receipt
          </button>
        ) : null}
      </div>

      {state.loading ? <p className="text-sm text-zinc-600">Loading receipts.</p> : null}
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      {state.linked.length > 0 ? (
        <ul className="space-y-2">
          {state.linked.map((receipt) => (
            <li key={receipt.id} className="rounded-xl border border-zinc-200 bg-white p-3">
              <button
                type="button"
                onClick={() => {
                  void state.openReceipt(receipt);
                }}
                className="w-full"
              >
                <ReceiptSummary receipt={receipt} />
              </button>
              {canUnlink ? (
                <button
                  type="button"
                  onClick={() => {
                    void state.unlink(receipt);
                  }}
                  disabled={state.isWorking}
                  className="mt-3 min-h-10 w-full rounded-lg border border-zinc-300 text-sm font-semibold text-zinc-800 disabled:opacity-60"
                >
                  Unlink
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {totalMessage ? <p className="text-sm text-zinc-700">{totalMessage}</p> : null}

      {state.pickerOpen ? (
        <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
          {state.pickerLoading ? <p className="text-sm text-zinc-600">Loading receipts.</p> : null}
          {state.pickerError ? (
            <p role="alert" className="text-sm text-red-700">
              {state.pickerError}
            </p>
          ) : null}
          {!state.pickerLoading && state.orderedUnassigned.length === 0 && !state.pickerError ? (
            <p className="text-sm text-zinc-600">
              No unassigned receipts.{" "}
              <Link href="/purchases/receipts" className="font-medium text-amber-700 hover:text-amber-800">
                Take a photo on the Receipts screen.
              </Link>
            </p>
          ) : null}
          <ul className="space-y-2">
            {state.orderedUnassigned.map((receipt) => (
              <li key={receipt.id}>
                <button
                  type="button"
                  onClick={() => {
                    void state.attach(receipt);
                  }}
                  disabled={state.isWorking}
                  className="w-full rounded-xl border border-zinc-200 p-3 hover:bg-zinc-50 disabled:opacity-60"
                >
                  <ReceiptSummary receipt={receipt} />
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={state.closePicker}
            className="min-h-10 w-full rounded-lg border border-zinc-300 text-sm font-semibold text-zinc-800"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {state.selected ? (
        <ReceiptViewer
          key={state.selected.id}
          receipt={state.selected}
          pageUrls={state.pageUrls}
          suppliers={state.suppliers}
          isSaving={state.isWorking}
          photosLoading={state.photosLoading}
          error={state.photosError}
          onClose={state.closeReceipt}
          onSave={state.updateReceipt}
          onDiscard={async () => ({ error: "Only an unassigned receipt can be discarded." })}
          onRetryPhotos={() => {
            if (state.selected) {
              void state.openReceipt(state.selected);
            }
          }}
        />
      ) : null}
    </section>
  );
}
