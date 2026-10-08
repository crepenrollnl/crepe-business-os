import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseFormValues, PurchaseWithRelations } from "../types/purchase";
import type { PurchaseReceiptCard } from "../types/purchase-receipt";
import type { PurchaseTaxResult } from "../types/purchase-tax";
import type { ServiceResult } from "@/types/service";

const {
  getPurchases,
  getSuppliers,
  getIngredients,
  getPurchaseById,
  saveDraft,
  receivePurchase,
  receivePurchaseAndPostJournal,
  getUnassigned,
  linkToPurchase,
  calculatePurchaseTaxes,
  getCurrentAccountingContext,
} = vi.hoisted(() => ({
  getPurchases: vi.fn(),
  getSuppliers: vi.fn(),
  getIngredients: vi.fn(),
  getPurchaseById: vi.fn(),
  saveDraft: vi.fn(),
  receivePurchase: vi.fn(),
  receivePurchaseAndPostJournal: vi.fn(),
  getUnassigned: vi.fn(),
  linkToPurchase: vi.fn(),
  calculatePurchaseTaxes: vi.fn(),
  getCurrentAccountingContext: vi.fn(),
}));

vi.mock("../services/purchase-service", () => ({
  purchaseService: {
    getPurchases: () => getPurchases(),
    getSuppliers: () => getSuppliers(),
    getIngredients: () => getIngredients(),
    getPurchaseById: (id: string) => getPurchaseById(id),
    saveDraft: (input: unknown) => saveDraft(input),
    receivePurchase: (input: unknown) => receivePurchase(input),
    receivePurchaseAndPostJournal: (...args: unknown[]) =>
      receivePurchaseAndPostJournal(...args),
  },
}));

vi.mock("../services/purchase-receipt-service", () => ({
  purchaseReceiptService: {
    getUnassigned: (id: string) => getUnassigned(id),
    linkToPurchase: (receiptId: string, purchaseId: string) =>
      linkToPurchase(receiptId, purchaseId),
  },
}));

vi.mock("../services/purchase-tax-service", () => ({
  purchaseTaxService: {
    calculatePurchaseTaxes: (document: unknown) => calculatePurchaseTaxes(document),
  },
}));

vi.mock("@/features/accounting/services/accounting-context-service", () => ({
  accountingContextService: {
    getCurrentAccountingContext: () => getCurrentAccountingContext(),
  },
}));

import { usePurchases } from "./use-purchases";

const RECEIPT_ID = "receipt-1";
const NEW_PURCHASE_ID = "purchase-new";
const SUPPLIER_ID = "supplier-1";

const TAX: PurchaseTaxResult = {
  document_id: null,
  mode: "calculate",
  is_valid: true,
  subtotal: 0,
  tax_total: 0,
  grand_total: 0,
  effective_tax_rate: 0,
  lines: [],
  warnings: [],
  tax_result: { currency: "EUR", breakdown: { lines: [] } },
};

function receiptCard(): PurchaseReceiptCard {
  return {
    id: RECEIPT_ID,
    purchaseId: null,
    supplierId: SUPPLIER_ID,
    supplierName: "Sligro",
    receiptDate: "2026-10-05",
    receiptTotal: 37.13,
    note: null,
    pageCount: 1,
    pagePaths: ["receipt/page.jpg"],
    thumbnailUrl: null,
    files: [],
  };
}

function savedPurchase(status: "draft" | "received" = "draft"): PurchaseWithRelations {
  return {
    id: NEW_PURCHASE_ID,
    supplier_id: SUPPLIER_ID,
    status,
    invoice_number: null,
    notes: null,
    subtotal: 0,
    tax_total: 0,
    total: 0,
    currency: "EUR",
    purchased_at: "2026-10-05T12:00:00.000Z",
    transaction_id: null,
    production_plan_id: null,
    tax_country: "NL",
    supplier_country: "NL",
    created_at: "2026-10-05T12:00:00.000Z",
    supplier: { id: SUPPLIER_ID, name: "Sligro" },
    items: [],
  };
}

function formValues(): PurchaseFormValues {
  return {
    supplier_id: SUPPLIER_ID,
    invoice_number: "",
    purchased_at: "2026-10-05",
    notes: "",
    supplier_country: "NL",
    tax_country: "NL",
    lines: [],
  };
}

function setUrl(search: string) {
  window.history.replaceState(null, "", `/purchases${search}`);
}

async function renderFromReceipt() {
  setUrl(`?fromReceipt=${RECEIPT_ID}&tab=x`);
  getUnassigned.mockResolvedValue({ data: receiptCard(), error: null });
  const hook = renderHook(() => usePurchases());
  await waitFor(() => {
    expect(hook.result.current.isModalOpen).toBe(true);
  });
  return hook;
}

describe("usePurchases from a receipt", () => {
  beforeEach(() => {
    getPurchases.mockResolvedValue({ data: [], error: null });
    getSuppliers.mockResolvedValue({ data: [], error: null });
    getIngredients.mockResolvedValue({ data: [], error: null });
    calculatePurchaseTaxes.mockResolvedValue({ data: TAX, error: null });
    saveDraft.mockResolvedValue({ data: savedPurchase(), error: null });
    getPurchaseById.mockResolvedValue({ data: savedPurchase(), error: null });
    linkToPurchase.mockResolvedValue({ data: true, error: null });
    getCurrentAccountingContext.mockResolvedValue({
      data: null,
      error: "No open fiscal period.",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setUrl("");
  });

  it("opens the create modal with supplier and date from the receipt", async () => {
    const { result } = await renderFromReceipt();

    expect(getUnassigned).toHaveBeenCalledWith(RECEIPT_ID);
    expect(result.current.editingPurchase).toBeNull();
    expect(result.current.sourceReceipt?.id).toBe(RECEIPT_ID);
    expect(result.current.cameFromReceipt).toBe(true);
    expect(result.current.initialFormValues.supplier_id).toBe(SUPPLIER_ID);
    expect(result.current.initialFormValues.purchased_at).toBe("2026-10-05");
  });

  it("shows a notice and keeps the modal closed when the receipt is not unassigned", async () => {
    setUrl(`?fromReceipt=${RECEIPT_ID}`);
    getUnassigned.mockResolvedValue({
      data: null,
      error: "This receipt is no longer unassigned.",
    });
    const { result } = renderHook(() => usePurchases());

    await waitFor(() => {
      expect(result.current.receiptNotice).toBe("This receipt is no longer unassigned.");
    });
    expect(result.current.isModalOpen).toBe(false);
    expect(result.current.sourceReceipt).toBeNull();

    act(() => {
      result.current.dismissReceiptNotice();
    });
    expect(result.current.receiptNotice).toBeNull();
  });

  it("links the receipt to the saved draft and reopens it", async () => {
    const { result } = await renderFromReceipt();

    let saved = false;
    await act(async () => {
      saved = await result.current.saveDraft(formValues());
    });

    expect(saved).toBe(true);
    expect(linkToPurchase).toHaveBeenCalledTimes(1);
    expect(linkToPurchase).toHaveBeenCalledWith(RECEIPT_ID, NEW_PURCHASE_ID);
    expect(getPurchaseById).toHaveBeenCalledWith(NEW_PURCHASE_ID);
    expect(linkToPurchase.mock.invocationCallOrder[0]).toBeLessThan(
      getPurchaseById.mock.invocationCallOrder[0] ?? 0,
    );
    expect(window.location.search).toBe("?tab=x");
    expect(result.current.isModalOpen).toBe(true);
    expect(result.current.editingPurchase?.id).toBe(NEW_PURCHASE_ID);
    expect(result.current.sourceReceipt).toBeNull();
    expect(result.current.cameFromReceipt).toBe(true);
    expect(result.current.actionError).toBeNull();
  });

  it("keeps the draft and explains when the link fails", async () => {
    linkToPurchase.mockResolvedValue({
      data: null,
      error: "This receipt is no longer unassigned.",
    });
    const { result } = await renderFromReceipt();

    await act(async () => {
      await result.current.saveDraft(formValues());
    });

    expect(linkToPurchase).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledTimes(1);
    expect(getPurchaseById).toHaveBeenCalledWith(NEW_PURCHASE_ID);
    expect(result.current.isModalOpen).toBe(true);
    expect(result.current.editingPurchase?.id).toBe(NEW_PURCHASE_ID);
    expect(result.current.actionError).toBe(
      "Draft saved. The receipt could not be attached: This receipt is no longer unassigned. Attach it in Receipts below.",
    );
  });

  it("does not link again when the reopened draft is saved", async () => {
    const { result } = await renderFromReceipt();

    await act(async () => {
      await result.current.saveDraft(formValues());
    });
    await act(async () => {
      await result.current.saveDraft(formValues());
    });

    expect(linkToPurchase).toHaveBeenCalledTimes(1);
    expect(saveDraft).toHaveBeenCalledTimes(2);
    expect(saveDraft.mock.calls[1]?.[0]).toMatchObject({ id: NEW_PURCHASE_ID });
  });

  it("links before showing the received purchase", async () => {
    let resolveLink: (value: ServiceResult<true>) => void = () => undefined;
    linkToPurchase.mockImplementation(
      () =>
        new Promise<ServiceResult<true>>((resolve) => {
          resolveLink = resolve;
        }),
    );
    receivePurchase.mockResolvedValue({ data: savedPurchase("received"), error: null });
    const { result } = await renderFromReceipt();

    let receivePromise: Promise<boolean> = Promise.resolve(false);
    act(() => {
      receivePromise = result.current.receiveGoods(formValues());
    });

    await waitFor(() => {
      expect(linkToPurchase).toHaveBeenCalledWith(RECEIPT_ID, NEW_PURCHASE_ID);
    });
    expect(result.current.editingPurchase).toBeNull();

    await act(async () => {
      resolveLink({ data: true, error: null });
      await receivePromise;
    });

    expect(linkToPurchase).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?tab=x");
    expect(result.current.editingPurchase?.id).toBe(NEW_PURCHASE_ID);
    expect(result.current.isModalOpen).toBe(true);
    expect(result.current.actionError).toBeNull();
  });

  it("creates a plain purchase without linking and closes the modal", async () => {
    setUrl("");
    const { result } = renderHook(() => usePurchases());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.openCreateModal();
    });
    expect(result.current.isModalOpen).toBe(true);

    await act(async () => {
      await result.current.saveDraft(formValues());
    });

    expect(getUnassigned).not.toHaveBeenCalled();
    expect(linkToPurchase).not.toHaveBeenCalled();
    expect(getPurchaseById).not.toHaveBeenCalled();
    expect(result.current.isModalOpen).toBe(false);
    expect(result.current.cameFromReceipt).toBe(false);
  });
});
