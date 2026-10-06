"use client";

import Link from "next/link";
import { DriveUnavailableNotice } from "../components/receipt-drive-status";
import { ReceiptCaptureForm } from "../components/receipt-capture-form";
import { ReceiptList } from "../components/receipt-list";
import { ReceiptViewer } from "../components/receipt-viewer";
import { useCanManagePurchaseReceipts } from "../hooks/use-can-manage-purchase-receipts";
import { useDriveReceiptSync } from "../hooks/use-drive-receipt-sync";
import { usePurchaseReceipts } from "../hooks/use-purchase-receipts";

export function PurchaseReceiptsPage() {
  const access = useCanManagePurchaseReceipts();
  const allowed = access.status === "allowed";
  const state = usePurchaseReceipts(allowed);
  const drive = useDriveReceiptSync(allowed, () => {
    void state.retry();
  });

  return (
    <div className="flex h-dvh flex-col bg-zinc-50">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-tight text-zinc-900">Receipts</p>
          <Link
            href="/purchases"
            className="text-sm font-medium text-amber-700 hover:text-amber-800"
          >
            Back to purchases
          </Link>
        </div>
      </header>

      {access.status === "loading" ? (
        <p className="px-4 py-6 text-sm text-zinc-600">Loading receipts.</p>
      ) : null}

      {access.status === "denied" ? (
        <p className="px-4 py-6 text-sm text-zinc-700">
          Receipts are available to the owner and partner only.
        </p>
      ) : null}

      {access.status === "error" ? (
        <div className="space-y-3 px-4 py-6">
          <p role="alert" className="text-sm text-red-700">
            Could not check your access.
          </p>
          <button
            type="button"
            onClick={access.retry}
            className="min-h-12 rounded-lg bg-zinc-900 px-4 text-base font-semibold text-white"
          >
            Retry
          </button>
        </div>
      ) : null}

      {allowed ? (
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
            <ReceiptCaptureForm
              suppliers={state.suppliers}
              isSaving={state.isSaving}
              onSave={state.save}
            />
            {drive.configured === true && drive.unavailable ? <DriveUnavailableNotice /> : null}
            <ReceiptList
              view={state.view}
              receipts={state.receipts}
              loading={state.loading}
              error={state.error}
              onViewChange={state.setView}
              onRetry={() => {
                void state.retry();
              }}
              onOpen={(receipt) => {
                void state.openReceipt(receipt);
              }}
              onDiscard={state.discardReceipt}
              driveConfigured={drive.configured === true}
              onRetryDrive={(fileIds) => {
                void drive.retryFiles(fileIds);
              }}
            />
          </div>
        </main>
      ) : null}

      {allowed && state.selected ? (
        <ReceiptViewer
          key={state.selected.id}
          receipt={state.selected}
          pageUrls={state.pageUrls}
          suppliers={state.suppliers}
          isSaving={state.isSaving}
          photosLoading={state.photosLoading}
          error={state.viewerError}
          onClose={state.closeReceipt}
          onSave={state.updateReceipt}
          onDiscard={state.discardReceipt}
          onRetryPhotos={() => {
            if (state.selected) {
              void state.openReceipt(state.selected);
            }
          }}
          driveConfigured={drive.configured === true}
          onRetryDrive={(fileIds) => {
            void drive.retryFiles(fileIds);
          }}
        />
      ) : null}
    </div>
  );
}
