/**
 * Manual Operating Expense Entry contracts (Critical Finding #3, Phase D, step 2).
 *
 * VAT rate is a plain client-side percentage select (21% / 9% / 0%) — the
 * expense form never touches the Netherlands Tax Pack / tax engine
 * (tax_jurisdictions / tax_definitions / tax_rates / calculate_purchase_taxes)
 * used by Purchases. record_expense (sql/083) takes net/vat amounts
 * directly, with no tax_code concept, so there is nothing to resolve there.
 */

export interface ExpenseAccountOption {
  id: string;
  code: string;
  name: string;
}

export interface ExpenseEntry {
  id: string;
  expense_date: string;
  account_id: string;
  description: string;
  supplier: string | null;
  net_amount: number;
  vat_amount: number;
  gross_amount: number;
  journal_entry_id: string | null;
  created_at: string;
  created_by: string | null;
}

export interface ExpenseEntryWithRelations extends ExpenseEntry {
  account: ExpenseAccountOption | null;
  posting_number: string | null;
}

export interface ExpenseVatRateOption {
  label: string;
  value: number;
}

export const EXPENSE_VAT_RATE_OPTIONS: readonly ExpenseVatRateOption[] = [
  { label: "21%", value: 0.21 },
  { label: "9%", value: 0.09 },
  { label: "0%", value: 0 },
];

export interface RecordExpenseInput {
  accountId: string;
  expenseDate: string;
  grossAmount: number;
  vatRate: number;
  description: string;
  supplier?: string | null;
}

export interface RecordExpenseResult {
  expenseEntryId: string;
  journalEntryId: string;
  postingNumber: string;
}

/** Net/VAT breakdown derived from a gross amount + VAT rate (form preview). */
export interface ExpenseAmountBreakdown {
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
}
