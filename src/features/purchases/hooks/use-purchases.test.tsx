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
  getUnassigned,
  linkToPurchase,
  calculatePurchaseTaxes,
  getCurrentAccountingContext,
  getPurchaseReceivedPostingStatus,
} = vi.hoisted(() => ({
  getPurchases: vi.fn(),
  getSuppliers: vi.fn(),
  getIngredients: vi.fn(),
  getPurchaseById: vi.fn(),
  saveDraft: vi.fn(),
  receivePurchase: vi.fn(),
  getUnassigned: vi.fn(),
  linkToPurchase: vi.fn(),
  calculatePurchaseTaxes: vi.fn(),
  getCurrentAccountingContext: vi.fn(),
  getPurchaseReceivedPostingStatus: vi.fn(),
}));

vi.mock("../services/purchase-service", () => ({
  purchaseService: {
    getPurchases: () => getPurchases(),
    getSuppliers: () => getSuppliers(),
    getIngredients: () => getIngredients(),
    getPurchaseById: (id: string) => getPurchaseById(id),
    saveDraft: (input: unknown) => saveDraft(input),
    receivePurchase: (input: unknown) => receivePurchase(input),
  },
}));

// Unconfigured → "pending" (journal not found), like a fresh database.
vi.mock("../services/purchase-posting-status-service", () => ({
  purchasePostingStatusService: {
    getPurchaseReceivedPostingStatus: (id: string) =>
      getPurchaseReceivedPostingStatus(id) ??
      Promise.resolve({ data: "pending", error: null }),
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

// Kept only to prove Receive never loads an accounting context (sql/150).
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    getPurchaseReceivedPostingStatus.mockReset();
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

describe("usePurchases.receiveGoods (sql/150: database posts the journal)", () => {
  beforeEach(() => {
    setUrl("");
    getPurchases.mockResolvedValue({ data: [], error: null });
    getSuppliers.mockResolvedValue({ data: [], error: null });
    getIngredients.mockResolvedValue({ data: [], error: null });
    calculatePurchaseTaxes.mockResolvedValue({ data: TAX, error: null });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    getPurchaseReceivedPostingStatus.mockReset();
    setUrl("");
  });

  async function receiveNewPurchase() {
    const { result } = renderHook(() => usePurchases());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.openCreateModal();
    });

    let received = false;
    await act(async () => {
      received = await result.current.receiveGoods(formValues());
    });

    return { result, received };
  }

  it("receives through receivePurchase only and never loads an accounting context", async () => {
    receivePurchase.mockResolvedValue({ data: savedPurchase("received"), error: null });

    const { result, received } = await receiveNewPurchase();

    expect(received).toBe(true);
    expect(receivePurchase).toHaveBeenCalledTimes(1);
    expect(getCurrentAccountingContext).not.toHaveBeenCalled();
    expect(result.current.editingPurchase?.status).toBe("received");
    expect(result.current.actionError).toBeNull();
    expect("postingError" in result.current).toBe(false);
  });

  it("shows the stored totals as the accounting preview (what the database posts)", async () => {
    receivePurchase.mockResolvedValue({
      data: { ...savedPurchase("received"), subtotal: 100, tax_total: 21, total: 121 },
      error: null,
    });

    const { result } = await receiveNewPurchase();

    expect(result.current.accountingPreview).toEqual({
      net_amount: 100,
      tax_total: 21,
      grand_total: 121,
      currency: "EUR",
      status: "draft_proposal",
      has_proposal: false,
      lines: [],
    });
  });

  it("marks the preview Posted when the database journal exists", async () => {
    receivePurchase.mockResolvedValue({
      data: { ...savedPurchase("received"), subtotal: 100, tax_total: 21, total: 121 },
      error: null,
    });
    getPurchaseReceivedPostingStatus.mockResolvedValue({ data: "posted", error: null });

    const { result } = await receiveNewPurchase();

    expect(getPurchaseReceivedPostingStatus).toHaveBeenCalledWith(NEW_PURCHASE_ID);
    expect(result.current.accountingPreview?.status).toBe("posted");
    expect(result.current.actionError).toBeNull();
  });

  it("keeps Draft Proposal without an error when the status read fails", async () => {
    receivePurchase.mockResolvedValue({ data: savedPurchase("received"), error: null });
    getPurchaseReceivedPostingStatus.mockResolvedValue({
      data: null,
      error: "Failed to load purchase accounting status",
    });

    const { result } = await receiveNewPurchase();

    expect(result.current.accountingPreview?.status).toBe("draft_proposal");
    expect(result.current.actionError).toBeNull();
  });

  it("keeps the modal on the draft and surfaces actionError when the receive fails", async () => {
    receivePurchase.mockResolvedValue({
      data: null,
      error: "This purchase has already been received.",
    });

    const { result, received } = await receiveNewPurchase();

    expect(received).toBe(false);
    expect(result.current.actionError).toBe(
      "This purchase has already been received.",
    );
    expect(result.current.accountingPreview).toBeNull();
    expect(getPurchaseReceivedPostingStatus).not.toHaveBeenCalled();
  });
});

describe("usePurchases opening a purchase (posting status)", () => {
  beforeEach(() => {
    getPurchases.mockResolvedValue({ data: [], error: null });
    getSuppliers.mockResolvedValue({ data: [], error: null });
    getIngredients.mockResolvedValue({ data: [], error: null });
    calculatePurchaseTaxes.mockResolvedValue({ data: TAX, error: null });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    getPurchaseReceivedPostingStatus.mockReset();
    setUrl("");
  });

  async function openFromUrl(purchase: PurchaseWithRelations) {
    setUrl(`?open=${purchase.id}`);
    getPurchaseById.mockResolvedValue({ data: purchase, error: null });
    const hook = renderHook(() => usePurchases());
    await waitFor(() => {
      expect(hook.result.current.editingPurchase?.id).toBe(purchase.id);
      expect(hook.result.current.isLoadingPurchase).toBe(false);
    });
    return hook;
  }

  it("shows a received purchase as Posted when its journal exists", async () => {
    getPurchaseReceivedPostingStatus.mockResolvedValue({ data: "posted", error: null });

    const { result } = await openFromUrl(savedPurchase("received"));

    expect(getPurchaseReceivedPostingStatus).toHaveBeenCalledWith(NEW_PURCHASE_ID);
    expect(result.current.accountingPreview?.status).toBe("posted");
  });

  it("keeps a received purchase without a journal as Draft Proposal", async () => {
    getPurchaseReceivedPostingStatus.mockResolvedValue({ data: "pending", error: null });

    const { result } = await openFromUrl(savedPurchase("received"));

    expect(result.current.accountingPreview?.status).toBe("draft_proposal");
  });

  it("does not read the posting status for a cancelled purchase", async () => {
    const { result } = await openFromUrl({
      ...savedPurchase("draft"),
      status: "cancelled",
    });

    expect(getPurchaseReceivedPostingStatus).not.toHaveBeenCalled();
    expect(result.current.accountingPreview?.status).toBe("draft_proposal");
  });

  it("does not read the posting status for a draft", async () => {
    const { result } = await openFromUrl(savedPurchase("draft"));

    expect(getPurchaseReceivedPostingStatus).not.toHaveBeenCalled();
    expect(result.current.accountingPreview).toBeNull();
  });
});
