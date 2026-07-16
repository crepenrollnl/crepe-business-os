/**
 * Accounting domain contracts.
 *
 * Prepared for General Ledger and double-entry posting.
 * Do not implement posting engines until the Accounting roadmap phase.
 */

export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense"
  | "contra_asset"
  | "contra_liability";

export interface Account {
  id: string;
  code: string;
  name: string;
  account_type: AccountType;
  parent_account_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

/**
 * One balanced journal document linked to a business Transaction.
 * Debits must equal credits for posted entries.
 */
export interface JournalEntry {
  id: string;
  transaction_id: string;
  entry_date: string;
  memo: string | null;
  created_at: string;
}

export interface JournalLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string | null;
}

export type PaymentMethod = "cash" | "card" | "bank_transfer" | "other";

export type PaymentDirection = "inbound" | "outbound";

export interface Payment {
  id: string;
  transaction_id: string | null;
  direction: PaymentDirection;
  method: PaymentMethod;
  amount: number;
  currency: string;
  paid_at: string;
  reference: string | null;
  created_at: string;
}

export interface TaxRate {
  id: string;
  name: string;
  rate: number;
  is_active: boolean;
  created_at: string;
}

export type VatPeriodStatus = "open" | "closed" | "filed";

export interface VatPeriod {
  id: string;
  start_date: string;
  end_date: string;
  status: VatPeriodStatus;
  filed_at: string | null;
  created_at: string;
}

/**
 * Statement projections that accounting modules will eventually serve.
 * Kept as contracts so Reports does not invent a second financial model.
 */
export type FinancialStatementType =
  | "trial_balance"
  | "balance_sheet"
  | "profit_and_loss"
  | "cash_flow"
  | "vat_return";
