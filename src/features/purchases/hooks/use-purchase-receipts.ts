"use client";

import { useCallback, useRef, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { purchaseReceiptService } from "../services/purchase-receipt-service";
import type {
  PurchaseReceiptCard,
  PurchaseReceiptSupplierOption,
  PurchaseReceiptView,
  SavePurchaseReceiptInput,
  UpdatePurchaseReceiptInput,
} from "../types/purchase-receipt";
import { missingSignedPage } from "../utils/receipt-purchase-link";

export function usePurchaseReceipts(enabled: boolean) {
  const [view, setView] = useState<PurchaseReceiptView>("unassigned");
  const [reloadKey, setReloadKey] = useState(0);
  const [receipts, setReceipts] = useState<PurchaseReceiptCard[]>([]);
  const [suppliers, setSuppliers] = useState<PurchaseReceiptSupplierOption[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selected, setSelected] = useState<PurchaseReceiptCard | null>(null);
  const [pageUrls, setPageUrls] = useState<string[]>([]);
  const [photosLoading, setPhotosLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const listGeneration = useRef(0);
  const selectedIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    void reloadKey;
    const generation = ++listGeneration.current;
    if (!enabled) {
      setReceipts([]);
      setSuppliers([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    const [listResult, supplierResult] = await Promise.all([
      view === "unassigned"
        ? purchaseReceiptService.listUnassigned()
        : purchaseReceiptService.listRecent(),
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
    setReceipts(listResult.data ?? []);
    setError(supplierResult.error);
    setLoading(false);
  }, [enabled, view, reloadKey]);

  useAsyncEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async (input: SavePurchaseReceiptInput) => {
    setIsSaving(true);
    const result = await purchaseReceiptService.save(input);
    if (result.error || !result.data) {
      setIsSaving(false);
      return { error: result.error ?? "Could not save the receipt." };
    }

    setView("unassigned");
    setReloadKey((current) => current + 1);
    setIsSaving(false);
    return { error: null };
  }, []);

  const openReceipt = useCallback(async (receipt: PurchaseReceiptCard) => {
    selectedIdRef.current = receipt.id;
    setSelected(receipt);
    setViewerError(null);
    setPageUrls([]);
    setPhotosLoading(true);
    const signed = await purchaseReceiptService.signStoragePaths(receipt.pagePaths);
    if (selectedIdRef.current !== receipt.id) {
      return;
    }
    setPhotosLoading(false);
    if (
      signed.error ||
      !signed.data ||
      missingSignedPage(receipt.pagePaths, signed.data)
    ) {
      setViewerError("Could not open the photo.");
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
    setViewerError(null);
  }, []);

  const updateReceipt = useCallback(
    async (input: UpdatePurchaseReceiptInput) => {
      if (!selected) {
        return { error: "Could not update the receipt." };
      }
      setIsSaving(true);
      const result = await purchaseReceiptService.update(selected.id, input);
      setIsSaving(false);
      if (result.error || !result.data) {
        return { error: result.error ?? "Could not update the receipt." };
      }
      const saved = result.data;
      setSelected(saved);
      setReceipts((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      return { error: null };
    },
    [selected],
  );

  const discardReceipt = useCallback(
    async (receipt: PurchaseReceiptCard) => {
      if (receipt.purchaseId) {
        return { error: "Only an unassigned receipt can be discarded." };
      }
      setIsSaving(true);
      const result = await purchaseReceiptService.discard(receipt.id);
      setIsSaving(false);
      if (result.error) {
        return { error: result.error };
      }
      setReceipts((current) => current.filter((item) => item.id !== receipt.id));
      if (selectedIdRef.current === receipt.id) {
        selectedIdRef.current = null;
        setSelected(null);
        setPageUrls([]);
        setPhotosLoading(false);
      }
      return { error: null };
    },
    [],
  );

  return {
    view,
    setView,
    receipts,
    suppliers,
    loading,
    error,
    isSaving,
    selected,
    pageUrls,
    photosLoading,
    viewerError,
    retry: load,
    save,
    openReceipt,
    closeReceipt,
    updateReceipt,
    discardReceipt,
  };
}

export function useUnassignedReceiptCount(enabled: boolean): {
  count: number;
  refresh: () => Promise<void>;
} {
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    if (!enabled) {
      setCount(0);
      return;
    }
    const result = await purchaseReceiptService.countUnassigned();
    setCount(result.data ?? 0);
  }, [enabled]);

  useAsyncEffect(() => {
    void load();
  }, [load]);

  return { count, refresh: load };
}
