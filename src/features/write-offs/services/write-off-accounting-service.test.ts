import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRoleBinding, FiscalPeriod } from "@/types/accounting";
import { ok, fail } from "@/types/service";

const recordWriteOff = vi.fn();
const getCurrentAccountingContext = vi.fn();
const post = vi.fn();

vi.mock("./write-off-service", () => ({
  writeOffService: {
    recordWriteOff: (...args: unknown[]) => recordWriteOff(...args),
  },
}));

vi.mock("@/features/accounting/services/accounting-context-service", () => ({
  accountingContextService: {
    getCurrentAccountingContext: () => getCurrentAccountingContext(),
  },
}));

vi.mock(
  "@/features/accounting/services/operational-accounting-integration-service",
  () => ({
    operationalAccountingIntegrationService: {
      post: (...args: unknown[]) => post(...args),
    },
  }),
);

import { writeOffAccountingService } from "./write-off-accounting-service";
import { WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE } from "../types/write-off";

const input = {
  itemType: "ingredient" as const,
  ingredientId: "ing-1",
  productId: null,
  quantity: 2,
  reason: "spoilage" as const,
  note: null,
};

function period(): FiscalPeriod {
  return {
    id: "period-1",
    name: "FY2026",
    start_date: "2026-01-01",
    end_date: "2026-12-31",
    status: "open",
    closed_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function bindings(): AccountRoleBinding[] {
  return [
    {
      id: "bind-waste",
      role: "waste_expense",
      account_id: "acct-6150",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "bind-raw",
      role: "inventory_asset",
      account_id: "acct-1100",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
  ];
}

describe("writeOffAccountingService.recordWriteOffAndPost", () => {
  beforeEach(() => {
    recordWriteOff.mockReset();
    getCurrentAccountingContext.mockReset();
    post.mockReset();
  });

  it("fails when the physical write-off RPC fails", async () => {
    recordWriteOff.mockResolvedValue(fail("Insufficient stock for Chicken."));

    const result =
      await writeOffAccountingService.recordWriteOffAndPost(input);

    expect(result.error).toBe("Insufficient stock for Chicken.");
    expect(post).not.toHaveBeenCalled();
  });

  it("records then posts a waste_recognized journal", async () => {
    recordWriteOff.mockResolvedValue(
      ok({ id: "wo-1", item_type: "ingredient", total_value: 15 }),
    );
    getCurrentAccountingContext.mockResolvedValue(
      ok({
        fiscalPeriod: period(),
        accountRoleBindings: bindings(),
        baseCurrency: "EUR",
        transactionCurrency: "EUR",
        exchangeRate: 1,
        rateDate: "2026-09-05",
      }),
    );
    post.mockResolvedValue(ok({ posting_status: "posted_now" }));

    const result =
      await writeOffAccountingService.recordWriteOffAndPost(input);

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      writeOff: { id: "wo-1", item_type: "ingredient", total_value: 15 },
      postingError: null,
      accountingNote: null,
    });
    expect(post).toHaveBeenCalledTimes(1);
    const request = post.mock.calls[0][0] as {
      event: { event_type: string; amounts: { other_amount: number } };
      context: { postingRules: { event_type: string }[] };
    };
    expect(request.event.event_type).toBe("waste_recognized");
    expect(request.event.amounts.other_amount).toBe(15);
    expect(request.context.postingRules[0].event_type).toBe("waste_recognized");
  });

  it("keeps the write-off when posting fails", async () => {
    recordWriteOff.mockResolvedValue(
      ok({ id: "wo-2", item_type: "ingredient", total_value: 15 }),
    );
    getCurrentAccountingContext.mockResolvedValue(
      ok({
        fiscalPeriod: period(),
        accountRoleBindings: bindings(),
        baseCurrency: "EUR",
        transactionCurrency: "EUR",
        exchangeRate: 1,
        rateDate: "2026-09-05",
      }),
    );
    post.mockResolvedValue(fail("No account bound to waste_expense."));

    const result =
      await writeOffAccountingService.recordWriteOffAndPost(input);

    expect(result.error).toBeNull();
    expect(result.data?.writeOff.id).toBe("wo-2");
    expect(result.data?.postingError).toBe(
      "No account bound to waste_expense.",
    );
    expect(result.data?.accountingNote).toBeNull();
  });

  it("skips posting when the write-off value is zero and explains why", async () => {
    recordWriteOff.mockResolvedValue(
      ok({ id: "wo-3", item_type: "ingredient", total_value: 0 }),
    );

    const result =
      await writeOffAccountingService.recordWriteOffAndPost(input);

    expect(result.error).toBeNull();
    expect(result.data?.postingError).toBeNull();
    expect(result.data?.accountingNote).toBe(
      WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE,
    );
    expect(getCurrentAccountingContext).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
