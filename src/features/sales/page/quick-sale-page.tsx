"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { QuickSaleCart } from "../components/quick-sale-cart";
import { QuickSaleTileGrid } from "../components/quick-sale-tile-grid";
import { SalesModeToggle } from "../components/sales-mode-toggle";
import { useQuickSale } from "../hooks/use-quick-sale";

export function QuickSalePage() {
  const {
    products,
    loading,
    error,
    cartLines,
    itemsTotal,
    discountType,
    setDiscountType,
    discountInput,
    setDiscountInput,
    discountAmount,
    payable,
    discountError,
    confirming,
    actionError,
    postingError,
    lastConfirmedSaleNumber,
    sendToQueue,
    kitchenNote,
    addToCart,
    incrementLine,
    decrementLine,
    setSendToQueue,
    setKitchenNote,
    confirm,
  } = useQuickSale();

  return (
    <DashboardLayout activePath="/sales">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
              Quick Sale
            </h1>
            <p className="mt-2 text-base text-zinc-600 sm:text-lg">
              Tap a dish, adjust quantity, confirm.
            </p>
          </div>

          <SalesModeToggle active="quick" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <QuickSaleTileGrid
            products={products}
            loading={loading}
            error={error}
            onTap={addToCart}
          />

          <QuickSaleCart
            lines={cartLines}
            itemsTotal={itemsTotal}
            discountType={discountType}
            discountInput={discountInput}
            discountAmount={discountAmount}
            payable={payable}
            discountError={discountError}
            confirming={confirming}
            actionError={actionError}
            postingError={postingError}
            lastConfirmedSaleNumber={lastConfirmedSaleNumber}
            sendToQueue={sendToQueue}
            kitchenNote={kitchenNote}
            onDiscountTypeChange={setDiscountType}
            onDiscountInputChange={setDiscountInput}
            onSendToQueueChange={setSendToQueue}
            onKitchenNoteChange={setKitchenNote}
            onIncrement={incrementLine}
            onDecrement={decrementLine}
            onConfirm={() => {
              void confirm();
            }}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
