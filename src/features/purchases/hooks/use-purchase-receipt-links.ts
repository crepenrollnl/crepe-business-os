"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { purchaseReceiptService } from "../services/purchase-receipt-service";
import type {
  PurchaseReceiptCard,
  PurchaseReceiptSupplierOption,
  UpdatePurchaseReceiptInput,
} from "../types/purchase-receipt";
import {
  compareUnassignedReceipts,
  missingSignedPage,
  RECEIPT_NO_LONGER_UNASSIGNED,
} from "../utils/receipt-purchase-link";

const PHOTO_ERROR = "Could not open the photo.";

interface UsePurchaseReceiptLinksInput {
  enabled: boolean;
  purchaseId: string | null;
  supplierId: string | null;
  purchasedAt: string;
}

export function usePurchaseReceiptLinks({
  enabled,
  purchaseId,
  supplierId,
  purchasedAt,
}: UsePurchaseReceiptLinksInput) {
  const [linked, setLinked] = useState<PurchaseReceiptCard[]>([]);
  const [suppliers, setSuppliers] = useState<PurchaseReceiptSupplierOption[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unassigned, setUnassigned] = useState<PurchaseReceiptCard[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [selected, setSelected] = useState<PurchaseReceiptCard | null>(null);
  const [pageUrls, setPageUrls] = useState<string[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const listGeneration = useRef(0);
  const pickerGeneration = useRef(0);
  const pickerOpenRef = useRef(false);
  const selectedIdRef = useRef<string | null>(null);

  const loadLinked = useCallback(async () => {
    const generation = ++listGeneration.current;
    if (!enabled || !purchaseId) {
      setLinked([]);
      setSuppliers([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    const [listResult, supplierResult] = await Promise.all([
      purchaseReceiptService.listForPurchase(purchaseId),
      purchaseReceiptService.listActiveSuppliers(),
    ]);
    if (generation !== listGeneration.current) {
      return;
    }

    if (supplierResult.data) {
      setSuppliers(supplierResult.data);
    }
    if (listResult.error) {
      setError(listResult.error);
      setLoading(false);
      return;
    }
    const next = listResult.data ?? [];
    setLinked(next);
    setSelected((current) => {
      if (!current) {
        return current;
      }
      return next.find((item) => item.id === current.id) ?? current;
    });
    setError(null);
    setLoading(false);
  }, [enabled, purchaseId]);

  useAsyncEffect(() => {
    void loadLinked();
  }, [loadLinked]);

  const loadPicker = useCallback(async () => {
    const generation = ++pickerGeneration.current;
    setPickerLoading(true);
    const result = await purchaseReceiptService.listUnassigned();
    if (generation !== pickerGeneration.current) {
      return;
    }
    setPickerLoading(false);
    if (result.error || !result.data) {
      setUnassigned([]);
      setPickerError(result.error ?? "Could not load receipts.");
      return;
    }
    setUnassigned(result.data);
    setPickerError(null);
  }, []);

  const orderedUnassigned = useMemo(
    () =>
      [...unassigned].sort((left, right) =>
        compareUnassignedReceipts(left, right, supplierId, purchasedAt),
      ),
    [unassigned, supplierId, purchasedAt],
  );

  const openPicker = useCallback(() => {
    if (pickerOpenRef.current) {
      return;
    }
    pickerOpenRef.current = true;
    setPickerOpen(true);
    setPickerError(null);
    void loadPicker();
  }, [loadPicker]);

  const closePicker = useCallback(() => {
    pickerOpenRef.current = false;
    setPickerOpen(false);
    setPickerError(null);
  }, []);

  const attach = useCallback(
    async (receipt: PurchaseReceiptCard) => {
      if (!purchaseId) {
        return { error: "Save the draft to attach a receipt." };
      }
      setIsWorking(true);
      const result = await purchaseReceiptService.linkToPurchase(receipt.id, purchaseId);
      setIsWorking(false);
      if (result.error) {
        if (result.error === RECEIPT_NO_LONGER_UNASSIGNED) {
          await loadPicker();
        }
        setPickerError(result.error);
        return { error: result.error };
      }
      pickerOpenRef.current = false;
      setPickerOpen(false);
      await loadLinked();
      return { error: null };
    },
    [loadLinked, loadPicker, purchaseId],
  );

  const unlink = useCallback(
    async (receipt: PurchaseReceiptCard) => {
      if (!purchaseId) {
        return { error: "Could not unlink the receipt." };
      }
      setIsWorking(true);
      const result = await purchaseReceiptService.unlinkFromPurchase(
        receipt.id,
        purchaseId,
      );
      setIsWorking(false);
      if (result.error) {
        setError(result.error);
        return { error: result.error };
      }
      if (selectedIdRef.current === receipt.id) {
        selectedIdRef.current = null;
        setSelected(null);
        setPageUrls([]);
        setPhotosLoading(false);
        setPhotosError(null);
      }
      await loadLinked();
      return { error: null };
    },
    [loadLinked, purchaseId],
  );

  const openReceipt = useCallback(async (receipt: PurchaseReceiptCard) => {
    selectedIdRef.current = receipt.id;
    setSelected(receipt);
    setPhotosError(null);
    setPageUrls([]);
    setPhotosLoading(true);
    const signed = await purchaseReceiptService.signStoragePaths(receipt.pagePaths);
    if (selectedIdRef.current !== receipt.id) {
      return;
    }
    setPhotosLoading(false);
    if (signed.error || !signed.data || missingSignedPage(receipt.pagePaths, signed.data)) {
      setPhotosError(PHOTO_ERROR);
      return;
    }
    setPageUrls(
      signed.data.filter((url): url is string => typeof url === "string" && url.length > 0),
    );
  }, []);

  const closeReceipt = useCallback(() => {
    selectedIdRef.current = null;
    setSelected(null);
    setPageUrls([]);
    setPhotosLoading(false);
    setPhotosError(null);
  }, []);

  const updateReceipt = useCallback(
    async (input: UpdatePurchaseReceiptInput) => {
      if (!selected) {
        return { error: "Could not update the receipt." };
      }
      setIsWorking(true);
      const result = await purchaseReceiptService.update(selected.id, input);
      setIsWorking(false);
      if (result.error || !result.data) {
        return { error: result.error ?? "Could not update the receipt." };
      }
      const saved = result.data;
      setSelected(saved);
      setLinked((current) => current.map((item) => (item.id === saved.id ? saved : item)));
      return { error: null };
    },
    [selected],
  );

  return {
    linked,
    suppliers,
    loading,
    error,
    pickerOpen,
    orderedUnassigned,
    pickerLoading,
    pickerError,
    isWorking,
    selected,
    pageUrls,
    photosLoading,
    photosError,
    openPicker,
    closePicker,
    attach,
    unlink,
    openReceipt,
    closeReceipt,
    reload: loadLinked,
    updateReceipt,
  };
}
