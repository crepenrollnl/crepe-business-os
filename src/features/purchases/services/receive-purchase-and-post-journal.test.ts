/**
 * Service-level coverage for receivePurchaseAndPostJournal (audit finding #3).
 *
 * receivePurchase has already succeeded and is durable by the time posting
 * is attempted — a posting failure must never look like the whole receive
 * failed (that would silently discard a real received purchase and its
 * stock update). Spies on receivePurchase directly (its own internals are
 * covered separately in purchase-service.test.ts) so this file can focus
 * purely on the ok()/fail() contract receivePurchaseAndPostJournal adds
 * around it — the same pattern as completeSessionAndPostJournal
 * (Production) / confirmSaleAndPostJournals (Sales).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseAccountingContext } from "../types/purchase-accounting";
import type { PurchaseTaxResult } from "../types/purchase-tax";
import type { PurchaseWithRelations, SavePurchaseInput } from "../types/purchase";

const { postJournalForPurchaseReceivedMock } = vi.hoisted(() => ({
  postJournalForPurchaseReceivedMock: vi.fn(),
}));

// Not exercised directly (receivePurchase is spied on below) — only needed
// so importing purchase-service.ts doesn't construct a real Supabase client.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}));

vi.mock("./purchase-accounting-service", () => ({
  purchaseAccountingService: {
    postJournalForPurchaseReceived: (...args: unknown[]) =>
      postJournalForPurchaseReceivedMock(...args),
  },
}));

import { purchaseService } from "./purchase-service";

const PURCHASE_ID = "purchase-1";

const ACCOUNTING_CONTEXT: PurchaseAccountingContext = {
  fiscalPeriod: {
    id: "period-1",
    name: "FY2026",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    status: "open",
    closed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
  },
  accountRoleBindings: [],
  baseCurrency: "EUR",
  exchangeRate: 1,
  rateDate: "2026-09-12",
};

function stubTax(): PurchaseTaxResult {
  return {
    document_id: PURCHASE_ID,
    mode: "calculate",
    is_valid: true,
    subtotal: 200,
    tax_total: 40,
    grand_total: 240,
    effective_tax_rate: 0.2,
    lines: [],
    warnings: [],
    tax_result: { currency: "EUR", breakdown: { lines: [] } },
  };
}

function receivedPurchase(): PurchaseWithRelations {
  return {
    id: PURCHASE_ID,
    supplier_id: "supplier-1",
    status: "received",
    invoice_number: "INV-1",
    notes: null,
    subtotal: 200,
    tax_total: 40,
    total: 240,
    currency: "EUR",
    purchased_at: "2026-09-12T09:00:00.000Z",
    transaction_id: null,
    production_plan_id: null,
    tax_country: null,
    supplier_country: null,
    created_at: "2026-09-12T09:00:00.000Z",
    supplier: { id: "supplier-1", name: "Dairy Co" },
    items: [],
  };
}

function saveInput(): SavePurchaseInput {
  return {
    id: PURCHASE_ID,
    supplier_id: "supplier-1",
    invoice_number: "INV-1",
    purchased_at: "2026-09-12T09:00:00.000Z",
    notes: "",
    supplier_country: "NL",
    tax_country: "NL",
    lines: [],
  };
}

describe("purchaseService.receivePurchaseAndPostJournal (audit finding #3)", () => {
  beforeEach(() => {
    postJournalForPurchaseReceivedMock.mockReset();
  });

  it("returns ok() with the posted journal when receive and posting both succeed", async () => {
    const receiveSpy = vi
      .spyOn(purchaseService, "receivePurchase")
      .mockResolvedValue({ data: receivedPurchase(), error: null });

    postJournalForPurchaseReceivedMock.mockResolvedValue({
      data: {
        purchase: receivedPurchase(),
        business_event_id: "evt-1",
        journalProposal: { status: "posted" },
        posted_journal: { posting_number: "JE-2026-000001" },
        posting_status: "posted_now",
        tax: stubTax(),
      },
      error: null,
    });

    const result = await purchaseService.receivePurchaseAndPostJournal(
      saveInput(),
      ACCOUNTING_CONTEXT,
      stubTax(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.purchase.status).toBe("received");
    expect(result.data?.posting).not.toBeNull();
    expect(result.data?.postingError).toBeNull();

    receiveSpy.mockRestore();
  });

  it("still returns ok() with the received purchase when posting fails — never discards a successful receive", async () => {
    const receiveSpy = vi
      .spyOn(purchaseService, "receivePurchase")
      .mockResolvedValue({ data: receivedPurchase(), error: null });

    postJournalForPurchaseReceivedMock.mockResolvedValue({
      data: null,
      error: "No open fiscal period covers today's date.",
    });

    const result = await purchaseService.receivePurchaseAndPostJournal(
      saveInput(),
      ACCOUNTING_CONTEXT,
      stubTax(),
    );

    expect(result.error).toBeNull();
    expect(result.data?.purchase.status).toBe("received");
    expect(result.data?.purchase.id).toBe(PURCHASE_ID);
    expect(result.data?.posting).toBeNull();
    expect(result.data?.postingError).toBe(
      "No open fiscal period covers today's date.",
    );

    receiveSpy.mockRestore();
  });

  it("returns fail() and never calls posting when receivePurchase itself fails", async () => {
    const receiveSpy = vi
      .spyOn(purchaseService, "receivePurchase")
      .mockResolvedValue({ data: null, error: "This purchase has already been received" });

    const result = await purchaseService.receivePurchaseAndPostJournal(
      saveInput(),
      ACCOUNTING_CONTEXT,
      stubTax(),
    );

    expect(result.data).toBeNull();
    expect(result.error).toBe("This purchase has already been received");
    expect(postJournalForPurchaseReceivedMock).not.toHaveBeenCalled();

    receiveSpy.mockRestore();
  });
});
