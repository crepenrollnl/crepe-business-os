/**
 * Manual Operating Expense Entry service coverage (Critical Finding #3,
 * Phase D, step 2).
 *
 * record_expense itself (posting/balancing) is covered in SQL (sql/083) —
 * this file covers gross -> net/vat derivation, RPC parameter construction,
 * list enrichment (account + posting_number), and the category filter.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { expenseService } from "./expense-service";

function queryChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.neq = vi.fn(self);
  chain.in = vi.fn(self);
  chain.order = vi.fn(self);
  chain.then = (
    resolve: (value: { data: unknown; error: unknown }) => void,
  ) => resolve(result);
  return chain;
}

describe("expenseService.recordExpense", () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
  });

  it("derives net/vat from gross + 21% rate and calls record_expense with the split amounts", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        expense_entry_id: "expense-1",
        journal_entry_id: "journal-1",
        posting_number: "JE-2026-000001",
      },
      error: null,
    });

    const result = await expenseService.recordExpense({
      accountId: "account-6060",
      expenseDate: "2026-08-03",
      grossAmount: 121,
      vatRate: 0.21,
      description: "Diesel fill-up",
      supplier: "Shell",
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith("record_expense", {
      p_account_id: "account-6060",
      p_expense_date: "2026-08-03",
      p_net_amount: 100,
      p_vat_amount: 21,
      p_description: "Diesel fill-up",
      p_supplier: "Shell",
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      expenseEntryId: "expense-1",
      journalEntryId: "journal-1",
      postingNumber: "JE-2026-000001",
    });
  });

  it("derives net/vat from gross + 9% rate with correct rounding", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        expense_entry_id: "expense-2",
        journal_entry_id: "journal-2",
        posting_number: "JE-2026-000002",
      },
      error: null,
    });

    await expenseService.recordExpense({
      accountId: "account-6010",
      expenseDate: "2026-08-03",
      grossAmount: 10,
      vatRate: 0.09,
      description: "Off-cycle flour",
    });

    // net = round(10 / 1.09, 2) = 9.17, vat = round(10 - 9.17, 2) = 0.83
    expect(supabaseMock.rpc).toHaveBeenCalledWith("record_expense", {
      p_account_id: "account-6010",
      p_expense_date: "2026-08-03",
      p_net_amount: 9.17,
      p_vat_amount: 0.83,
      p_description: "Off-cycle flour",
      p_supplier: null,
    });
  });

  it("treats a 0% rate as net === gross with zero VAT", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        expense_entry_id: "expense-3",
        journal_entry_id: "journal-3",
        posting_number: "JE-2026-000003",
      },
      error: null,
    });

    await expenseService.recordExpense({
      accountId: "account-6140",
      expenseDate: "2026-08-03",
      grossAmount: 50,
      vatRate: 0,
      description: "Government fee",
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith("record_expense", {
      p_account_id: "account-6140",
      p_expense_date: "2026-08-03",
      p_net_amount: 50,
      p_vat_amount: 0,
      p_description: "Government fee",
      p_supplier: null,
    });
  });

  it("trims description/supplier and sends null for a blank supplier", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        expense_entry_id: "expense-4",
        journal_entry_id: "journal-4",
        posting_number: "JE-2026-000004",
      },
      error: null,
    });

    await expenseService.recordExpense({
      accountId: "account-6020",
      expenseDate: "2026-08-03",
      grossAmount: 20,
      vatRate: 0.21,
      description: "  Packaging boxes  ",
      supplier: "   ",
    });

    expect(supabaseMock.rpc).toHaveBeenCalledWith(
      "record_expense",
      expect.objectContaining({
        p_description: "Packaging boxes",
        p_supplier: null,
      }),
    );
  });

  it("surfaces the RPC's own error message instead of a generic fallback", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "No open fiscal period covers this date." },
    });

    const result = await expenseService.recordExpense({
      accountId: "account-6060",
      expenseDate: "2019-01-01",
      grossAmount: 100,
      vatRate: 0.21,
      description: "Old receipt",
    });

    expect(result.data).toBeNull();
    expect(result.error).toBe("No open fiscal period covers this date.");
  });
});

describe("expenseService.listExpenses", () => {
  beforeEach(() => {
    supabaseMock.from.mockReset();
  });

  it("enriches expense rows with the account and posting_number of their journal", async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "expense_entries") {
        return queryChain({
          data: [
            {
              id: "expense-1",
              expense_date: "2026-08-03",
              account_id: "account-6060",
              description: "Diesel fill-up",
              supplier: "Shell",
              net_amount: 100,
              vat_amount: 21,
              gross_amount: 121,
              journal_entry_id: "journal-1",
              created_at: "2026-08-03T10:00:00.000Z",
              created_by: "user-1",
            },
          ],
          error: null,
        });
      }
      if (table === "accounts") {
        return queryChain({
          data: [{ id: "account-6060", code: "6060", name: "Fuel & Transport" }],
          error: null,
        });
      }
      if (table === "journal_entries") {
        return queryChain({
          data: [{ id: "journal-1", posting_number: "JE-2026-000001" }],
          error: null,
        });
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await expenseService.listExpenses();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      expect.objectContaining({
        id: "expense-1",
        account: { id: "account-6060", code: "6060", name: "Fuel & Transport" },
        posting_number: "JE-2026-000001",
      }),
    ]);
  });

  it("returns an empty list without querying accounts/journals when there are no expenses", async () => {
    const accountsFrom = vi.fn();
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "expense_entries") {
        return queryChain({ data: [], error: null });
      }
      accountsFrom(table);
      return queryChain({ data: [], error: null });
    });

    const result = await expenseService.listExpenses();

    expect(result.data).toEqual([]);
    expect(accountsFrom).not.toHaveBeenCalled();
  });

  it("maps a missing journal_entry_id to a null posting_number", async () => {
    supabaseMock.from.mockImplementation((table: string) => {
      if (table === "expense_entries") {
        return queryChain({
          data: [
            {
              id: "expense-2",
              expense_date: "2026-08-03",
              account_id: "account-6010",
              description: "Cash-only stall fee",
              supplier: null,
              net_amount: 15,
              vat_amount: 0,
              gross_amount: 15,
              journal_entry_id: null,
              created_at: "2026-08-03T10:00:00.000Z",
              created_by: null,
            },
          ],
          error: null,
        });
      }
      if (table === "accounts") {
        return queryChain({
          data: [{ id: "account-6010", code: "6010", name: "Ingredients (off-cycle)" }],
          error: null,
        });
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    const result = await expenseService.listExpenses();

    expect(result.data?.[0]?.posting_number).toBeNull();
  });

  it("fails clearly when expense_entries cannot be loaded", async () => {
    supabaseMock.from.mockImplementation(() =>
      queryChain({ data: null, error: { message: "boom" } }),
    );

    const result = await expenseService.listExpenses();

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

const GROUP_2_EXPENSE_CODES = [
  "6010",
  "6020",
  "6030",
  "6040",
  "6050",
  "6060",
  "6070",
  "6080",
  "6090",
  "6100",
  "6110",
  "6120",
  "6130",
  "6140",
];

/**
 * Unlike queryChain, this mock actually applies .eq()/.in() filters against
 * the given rows before resolving — needed to prove getExpenseAccounts'
 * allow-list genuinely excludes rows, not just that some method was called
 * with some arguments.
 */
function filterableAccountsChain(rows: Array<Record<string, unknown>>) {
  let result = rows;
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn((field: string, value: unknown) => {
    result = result.filter((row) => row[field] === value);
    return chain;
  });
  chain.in = vi.fn((field: string, values: readonly unknown[]) => {
    result = result.filter((row) => values.includes(row[field]));
    return chain;
  });
  chain.order = vi.fn(() => chain);
  chain.then = (
    resolve: (value: { data: unknown; error: unknown }) => void,
  ) => resolve({ data: result, error: null });
  return chain;
}

describe("expenseService.getExpenseAccounts", () => {
  beforeEach(() => {
    supabaseMock.from.mockReset();
  });

  it("filters to active expense accounts using the Group 2 allow-list", async () => {
    const chain = queryChain({
      data: [
        { id: "account-6010", code: "6010", name: "Ingredients (off-cycle)" },
        { id: "account-6140", code: "6140", name: "Taxes & Government Fees" },
      ],
      error: null,
    });
    supabaseMock.from.mockReturnValue(chain);

    const result = await expenseService.getExpenseAccounts();

    expect(supabaseMock.from).toHaveBeenCalledWith("accounts");
    expect(chain.eq).toHaveBeenCalledWith("account_type", "expense");
    expect(chain.eq).toHaveBeenCalledWith("is_active", true);
    expect(chain.in).toHaveBeenCalledWith("code", GROUP_2_EXPENSE_CODES);
    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(2);
  });

  it("excludes COGS (5000) and Depreciation Expense (6200) even when both are present with account_type='expense' and is_active=true", async () => {
    supabaseMock.from.mockReturnValue(
      filterableAccountsChain([
        {
          id: "account-5000",
          code: "5000",
          name: "Cost of Goods Sold",
          account_type: "expense",
          is_active: true,
        },
        {
          id: "account-6200",
          code: "6200",
          name: "Depreciation Expense",
          account_type: "expense",
          is_active: true,
        },
        {
          id: "account-6010",
          code: "6010",
          name: "Ingredients (off-cycle)",
          account_type: "expense",
          is_active: true,
        },
        {
          id: "account-6140",
          code: "6140",
          name: "Taxes & Government Fees",
          account_type: "expense",
          is_active: true,
        },
      ]),
    );

    const result = await expenseService.getExpenseAccounts();

    const codes = (result.data ?? []).map((account) => account.code);
    expect(codes).not.toContain("5000");
    expect(codes).not.toContain("6200");
    expect(codes.sort()).toEqual(["6010", "6140"]);
  });

  it("fails clearly when accounts cannot be loaded", async () => {
    supabaseMock.from.mockReturnValue(
      queryChain({ data: null, error: { message: "boom" } }),
    );

    const result = await expenseService.getExpenseAccounts();

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
