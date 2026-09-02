"use client";

import { QuickSaleCart } from "@/components/quick-sale-cart";
import { QuickSaleTileGrid } from "@/components/quick-sale-tile-grid";
import { usePosSale } from "../hooks/use-pos-sale";

export function PosSalePane() {
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
  } = usePosSale();

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
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
  );
}
