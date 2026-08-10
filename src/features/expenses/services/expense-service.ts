/**
 * Manual Operating Expense Entry service (Critical Finding #3, Phase D, step 2).
 *
 * Thin wrapper around the record_expense RPC (sql/083) plus read access to
 * expense_entries / accounts for the /expenses list and category select.
 * Never writes journal_entries / journal_lines / ledger_entries directly —
 * record_expense is the only writer of those from this feature.
 */

import { roundMoney } from "@/lib/money";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  ExpenseAccountOption,
  ExpenseEntry,
  ExpenseEntryWithRelations,
  RecordExpenseInput,
  RecordExpenseResult,
} from "../types/expense";

/**
 * Chart of Accounts codes for the 14 Group 2 manual operating-expense
 * accounts (sql/081 seed) — the only ones a human should ever pick from
 * this form. account_type = 'expense' is shared by two other accounts that
 * must never appear here: 5000 (Cost of Goods Sold — comes only from Sale
 * Batch Consumption, per AGENTS.md) and 6200 (Depreciation Expense, Group 3
 * — reserved for the future Phase E automatic posting, not manual entry).
 * An explicit allow-list is used instead of excluding those two codes,
 * because an exclude-list silently admits any *new* expense-type account
 * added later (e.g. a future Group 3 addition) — an allow-list does not.
 */
const EXPENSE_CATEGORY_CODES = [
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
] as const;

interface RecordExpenseRpcResult {
  expense_entry_id: string;
  journal_entry_id: string;
  posting_number: string;
}

function toRecordExpenseResult(
  rpc: RecordExpenseRpcResult,
): RecordExpenseResult {
  return {
    expenseEntryId: rpc.expense_entry_id,
    journalEntryId: rpc.journal_entry_id,
    postingNumber: rpc.posting_number,
  };
}

export const expenseService = {
  /**
   * Compute net/VAT from gross + rate, then call record_expense (sql/083),
   * which posts the balanced journal and inserts expense_entries in one
   * transaction. Rounds once, up front — net = gross / (1 + rate), vat =
   * gross - net — so net + vat always equals gross exactly.
   */
  async recordExpense(
    input: RecordExpenseInput,
  ): Promise<ServiceResult<RecordExpenseResult>> {
    try {
      const grossAmount = roundMoney(input.grossAmount);
      const netAmount = roundMoney(grossAmount / (1 + input.vatRate));
      const vatAmount = roundMoney(grossAmount - netAmount);

      const trimmedDescription = input.description.trim();
      const trimmedSupplier = input.supplier?.trim() ?? "";

      const { data, error } = await supabase.rpc("record_expense", {
        p_account_id: input.accountId,
        p_expense_date: input.expenseDate,
        p_net_amount: netAmount,
        p_vat_amount: vatAmount,
        p_description: trimmedDescription,
        p_supplier: trimmedSupplier.length > 0 ? trimmedSupplier : null,
      });

      if (error || !data) {
        return fail(toUserError(error, "Failed to record expense."));
      }

      return ok(toRecordExpenseResult(data as RecordExpenseRpcResult));
    } catch (error) {
      return fail(toUserError(error, "Failed to record expense."));
    }
  },

  /**
   * List recorded expenses newest-first, enriched with the account
   * (code/name) and the posting_number of the journal each one created —
   * confirms a real posting exists behind every row.
   */
  async listExpenses(): Promise<ServiceResult<ExpenseEntryWithRelations[]>> {
    try {
      const { data, error } = await supabase
        .from("expense_entries")
        .select(
          "id, expense_date, account_id, description, supplier, net_amount, vat_amount, gross_amount, journal_entry_id, created_at, created_by",
        )
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) {
        return fail(toUserError(error, "Failed to load expenses."));
      }

      const rows = (data ?? []) as ExpenseEntry[];

      const accountIds = [...new Set(rows.map((row) => row.account_id))];
      const journalEntryIds = [
        ...new Set(
          rows
            .map((row) => row.journal_entry_id)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      const [accountsResult, journalsResult] = await Promise.all([
        accountIds.length > 0
          ? supabase.from("accounts").select("id, code, name").in(
              "id",
              accountIds,
            )
          : Promise.resolve({ data: [], error: null }),
        journalEntryIds.length > 0
          ? supabase
              .from("journal_entries")
              .select("id, posting_number")
              .in("id", journalEntryIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (accountsResult.error) {
        return fail(
          toUserError(accountsResult.error, "Failed to load expense accounts."),
        );
      }

      if (journalsResult.error) {
        return fail(
          toUserError(journalsResult.error, "Failed to load posted journals."),
        );
      }

      const accountMap = new Map<string, ExpenseAccountOption>(
        (accountsResult.data ?? []).map((account) => [
          account.id as string,
          account as ExpenseAccountOption,
        ]),
      );

      const postingNumberMap = new Map<string, string | null>(
        (journalsResult.data ?? []).map((journal) => [
          journal.id as string,
          (journal.posting_number as string | null) ?? null,
        ]),
      );

      const enriched: ExpenseEntryWithRelations[] = rows.map((row) => ({
        ...row,
        account: accountMap.get(row.account_id) ?? null,
        posting_number: row.journal_entry_id
          ? (postingNumberMap.get(row.journal_entry_id) ?? null)
          : null,
      }));

      return ok(enriched);
    } catch (error) {
      return fail(toUserError(error, "Failed to load expenses."));
    }
  },

  /**
   * Expense category options for the form select: exactly the 14 Group 2
   * accounts (EXPENSE_CATEGORY_CODES), never 5000 (COGS) or 6200
   * (Depreciation Expense) even though both share account_type = 'expense'.
   */
  async getExpenseAccounts(): Promise<ServiceResult<ExpenseAccountOption[]>> {
    try {
      const { data, error } = await supabase
        .from("accounts")
        .select("id, code, name")
        .eq("account_type", "expense")
        .eq("is_active", true)
        .in("code", EXPENSE_CATEGORY_CODES)
        .order("code");

      if (error) {
        return fail(toUserError(error, "Failed to load expense accounts."));
      }

      return ok((data ?? []) as ExpenseAccountOption[]);
    } catch (error) {
      return fail(toUserError(error, "Failed to load expense accounts."));
    }
  },
};
