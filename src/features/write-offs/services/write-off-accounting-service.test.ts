import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRoleBinding, FiscalPeriod } from "@/types/accounting";
import { ok, fail } from "@/types/service";

const {
  recordWriteOff,
  recordDishWriteOff,
  getCurrentAccountingContext,
  post,
  reportPostingFailure,
} = vi.hoisted(() => ({
  recordWriteOff: vi.fn(),
  recordDishWriteOff: vi.fn(),
  getCurrentAccountingContext: vi.fn(),
  post: vi.fn(),
  reportPostingFailure: vi.fn(),
}));

vi.mock("./write-off-service", () => ({
  writeOffService: {
    recordWriteOff: (...args: unknown[]) => recordWriteOff(...args),
    recordDishWriteOff: (...args: unknown[]) => recordDishWriteOff(...args),
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

vi.mock("@/features/accounting/utils/report-posting-failure", () => ({
  reportPostingFailure: (...args: unknown[]) => reportPostingFailure(...args),
}));

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
    reportPostingFailure.mockReset();
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
    expect(reportPostingFailure).not.toHaveBeenCalled();
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
    expect(reportPostingFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFlow: "write_off_record",
        entityType: "write_off",
        entityId: "wo-2",
        businessEventId: (
          post.mock.calls[0][0] as { event: { id: string } }
        ).event.id,
        errorMessage: "No account bound to waste_expense.",
      }),
    );
  });

  it("reports a posting failure when accounting context is unavailable", async () => {
    recordWriteOff.mockResolvedValue(
      ok({ id: "wo-4", item_type: "ingredient", total_value: 15 }),
    );
    getCurrentAccountingContext.mockResolvedValue(
      fail("Accounting context is unavailable."),
    );

    const result =
      await writeOffAccountingService.recordWriteOffAndPost(input);

    expect(result.error).toBeNull();
    expect(result.data?.writeOff.id).toBe("wo-4");
    expect(result.data?.postingError).toBe(
      "Accounting context is unavailable.",
    );
    expect(post).not.toHaveBeenCalled();
    expect(reportPostingFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFlow: "write_off_record",
        entityType: "write_off",
        entityId: "wo-4",
        businessEventId: null,
        errorMessage: "Accounting context is unavailable.",
      }),
    );
  });

  it("reports a posting failure when the accounting event cannot be built", async () => {
    recordWriteOff.mockResolvedValue(
      ok({ id: "wo-5", item_type: "ingredient", total_value: 15 }),
    );
    getCurrentAccountingContext.mockResolvedValue(
      ok({
        fiscalPeriod: period(),
        accountRoleBindings: bindings(),
        baseCurrency: "EUR",
        transactionCurrency: "EUR",
        exchangeRate: 0,
        rateDate: "2026-09-05",
      }),
    );

    const result =
      await writeOffAccountingService.recordWriteOffAndPost(input);

    expect(result.error).toBeNull();
    expect(result.data?.writeOff.id).toBe("wo-5");
    expect(result.data?.postingError).toBe(
      "Exchange rate must be a finite number greater than zero.",
    );
    expect(post).not.toHaveBeenCalled();
    expect(reportPostingFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceFlow: "write_off_record",
        entityType: "write_off",
        entityId: "wo-5",
        businessEventId: null,
        errorMessage:
          "Exchange rate must be a finite number greater than zero.",
      }),
    );
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
    expect(reportPostingFailure).not.toHaveBeenCalled();
  });
});

describe("writeOffAccountingService.recordDishWriteOffAndPost", () => {
  beforeEach(() => {
    recordDishWriteOff.mockReset();
    getCurrentAccountingContext.mockReset();
    post.mockReset();
    reportPostingFailure.mockReset();
  });

  const dishInput = {
    productId: "dish-1",
    quantity: 1,
    reason: "spoilage" as const,
    note: "burned",
  };

  function accountingContext() {
    return ok({
      fiscalPeriod: period(),
      accountRoleBindings: bindings(),
      baseCurrency: "EUR",
      transactionCurrency: "EUR",
      exchangeRate: 1,
      rateDate: "2026-09-05",
    });
  }

  function dishResult(
    rows: Array<{ id: string; item_type: "ingredient" | "finished_good"; total_value: number }>,
  ) {
    return ok({
      product_id: "dish-1",
      quantity: 1,
      total_value: rows.reduce((sum, row) => sum + row.total_value, 0),
      write_offs: rows,
    });
  }

  interface PostRequest {
    event: {
      event_type: string;
      idempotency_key: string;
      source_document_id: string;
      amounts: { other_amount: number };
    };
    context: { postingRules: { id: string }[] };
  }

  function postRequests(): PostRequest[] {
    return post.mock.calls.map((call) => call[0] as PostRequest);
  }

  it("fails and posts nothing when the dish write-off RPC fails", async () => {
    recordDishWriteOff.mockResolvedValue(
      fail('Could not write off "Nutella" for dish "Crepe Nutella": Insufficient stock.'),
    );

    const result = await writeOffAccountingService.recordDishWriteOffAndPost(dishInput);

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      'Could not write off "Nutella" for dish "Crepe Nutella": Insufficient stock.',
    );
    expect(getCurrentAccountingContext).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("posts one journal per part with its own key and posting rule, loading context once", async () => {
    recordDishWriteOff.mockResolvedValue(
      dishResult([
        { id: "wo-1", item_type: "ingredient", total_value: 1.5 },
        { id: "wo-2", item_type: "finished_good", total_value: 2 },
      ]),
    );
    getCurrentAccountingContext.mockResolvedValue(accountingContext());
    post.mockResolvedValue(ok({ posting_status: "posted_now" }));

    const result = await writeOffAccountingService.recordDishWriteOffAndPost(dishInput);

    expect(result.error).toBeNull();
    expect(result.data?.postingErrors).toEqual([]);
    expect(result.data?.accountingNote).toBeNull();
    expect(result.data?.dishWriteOff.write_offs).toHaveLength(2);
    expect(getCurrentAccountingContext).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(2);
    const [first, second] = postRequests();
    expect(first?.event.event_type).toBe("waste_recognized");
    expect(first?.event.idempotency_key).toBe("waste_recognized:wo-1");
    expect(first?.event.source_document_id).toBe("wo-1");
    expect(first?.event.amounts.other_amount).toBe(1.5);
    expect(first?.context.postingRules[0]?.id).toBe("posting-rule-write-off-v1-ingredient");
    expect(second?.event.idempotency_key).toBe("waste_recognized:wo-2");
    expect(second?.event.amounts.other_amount).toBe(2);
    expect(second?.context.postingRules[0]?.id).toBe("posting-rule-write-off-v1-finished_good");
    expect(reportPostingFailure).not.toHaveBeenCalled();
  });

  it("keeps posting the other parts when one part fails and returns its error", async () => {
    recordDishWriteOff.mockResolvedValue(
      dishResult([
        { id: "wo-1", item_type: "ingredient", total_value: 1.5 },
        { id: "wo-2", item_type: "ingredient", total_value: 2 },
        { id: "wo-3", item_type: "finished_good", total_value: 3 },
      ]),
    );
    getCurrentAccountingContext.mockResolvedValue(accountingContext());
    post
      .mockResolvedValueOnce(fail("Journal is unbalanced."))
      .mockResolvedValueOnce(ok({ posting_status: "posted_now" }))
      .mockResolvedValueOnce(fail("Journal is unbalanced."));

    const result = await writeOffAccountingService.recordDishWriteOffAndPost(dishInput);

    expect(result.error).toBeNull();
    expect(post).toHaveBeenCalledTimes(3);
    expect(result.data?.postingErrors).toEqual(["Journal is unbalanced."]);
    expect(reportPostingFailure).toHaveBeenCalledTimes(2);
    expect(reportPostingFailure.mock.calls.map((call) => call[0].entityId)).toEqual([
      "wo-1",
      "wo-3",
    ]);
  });

  it("skips parts with zero value", async () => {
    recordDishWriteOff.mockResolvedValue(
      dishResult([
        { id: "wo-1", item_type: "ingredient", total_value: 0 },
        { id: "wo-2", item_type: "finished_good", total_value: 2 },
      ]),
    );
    getCurrentAccountingContext.mockResolvedValue(accountingContext());
    post.mockResolvedValue(ok({ posting_status: "posted_now" }));

    const result = await writeOffAccountingService.recordDishWriteOffAndPost(dishInput);

    expect(post).toHaveBeenCalledTimes(1);
    expect(postRequests()[0]?.event.idempotency_key).toBe("waste_recognized:wo-2");
    expect(result.data?.accountingNote).toBeNull();
    expect(result.data?.postingErrors).toEqual([]);
  });

  it("explains when no part carried a cost and posts nothing", async () => {
    recordDishWriteOff.mockResolvedValue(
      dishResult([
        { id: "wo-1", item_type: "ingredient", total_value: 0 },
        { id: "wo-2", item_type: "finished_good", total_value: 0 },
      ]),
    );

    const result = await writeOffAccountingService.recordDishWriteOffAndPost(dishInput);

    expect(result.error).toBeNull();
    expect(result.data?.accountingNote).toBe(WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE);
    expect(result.data?.postingErrors).toEqual([]);
    expect(getCurrentAccountingContext).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it("reports every costed part when the accounting context is unavailable", async () => {
    recordDishWriteOff.mockResolvedValue(
      dishResult([
        { id: "wo-1", item_type: "ingredient", total_value: 1 },
        { id: "wo-2", item_type: "ingredient", total_value: 0 },
        { id: "wo-3", item_type: "finished_good", total_value: 2 },
      ]),
    );
    getCurrentAccountingContext.mockResolvedValue(fail("No open fiscal period for today."));

    const result = await writeOffAccountingService.recordDishWriteOffAndPost(dishInput);

    expect(result.error).toBeNull();
    expect(result.data?.postingErrors).toEqual(["No open fiscal period for today."]);
    expect(result.data?.accountingNote).toBeNull();
    expect(post).not.toHaveBeenCalled();
    expect(reportPostingFailure.mock.calls.map((call) => call[0].entityId)).toEqual([
      "wo-1",
      "wo-3",
    ]);
  });
});
