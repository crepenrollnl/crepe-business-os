/**
 * Accounting domain contracts.
 *
 * Accounting is the sole financial module. It owns VAT, taxes, bank accounts,
 * general ledger, journal entries, statements, fixed assets, and payroll integration.
 *
 * Canonical architecture: docs/ACCOUNTING.md
 * Data model proposal: docs/ACCOUNTING_DATA_MODEL.md
 *
 * Do not implement posting engines until the Accounting roadmap phase.
 * Operational modules must never write accounting tables — they emit business events.
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
  /** Leaf accounts accept journal lines; headers are grouping-only. */
  is_postable: boolean;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export type FiscalPeriodStatus = "open" | "closed" | "locked";

export interface FiscalPeriod {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: FiscalPeriodStatus;
  closed_at: string | null;
  created_at: string;
  updated_at?: string;
}

export interface CurrencyRate {
  id: string;
  base_currency: string;
  quote_currency: string;
  /** Multiply quote (transaction) amount to obtain base amount. */
  rate: number;
  rate_date: string;
  source: "manual" | "feed" | "system";
  created_at: string;
}

/**
 * Money facts carried on an Accounting Business Event.
 * Emitters supply facts; Accounting does not recalculate from operational domains.
 */
export interface AccountingEventAmounts {
  gross_amount: number | null;
  net_amount: number | null;
  tax_amount: number | null;
  cogs_amount: number | null;
  discount_amount: number | null;
  shipping_amount: number | null;
  other_amount: number | null;
}

export interface AccountingEventTaxLine {
  tax_code: string;
  direction: "input" | "output";
  rate: number;
  net_amount: number;
  tax_amount: number;
}

export type AccountingBusinessEventType =
  | "purchase_received"
  | "purchase_paid"
  | "sale_completed"
  | "sale_refunded"
  | "cogs_recognized"
  | "production_completed"
  | "inventory_adjusted"
  | "waste_recognized"
  | "expense_recognized"
  | "payment_received"
  | "payment_sent"
  | "fx_revaluation";

export type AccountingBusinessEventPostingStatus =
  | "pending"
  | "posted"
  | "failed"
  | "skipped";

/**
 * Immutable financial intake for the Posting Engine.
 * Opaque source references only — no Inventory/Recipe/Product payloads.
 */
export interface AccountingBusinessEvent {
  id: string;
  event_type: AccountingBusinessEventType;
  transaction_id: string | null;
  source_module: string;
  source_document_type: string;
  source_document_id: string;
  idempotency_key: string;
  occurred_at: string;
  transaction_currency: string;
  base_currency: string;
  exchange_rate: number;
  rate_date: string;
  amounts: AccountingEventAmounts;
  tax_lines: AccountingEventTaxLine[];
  posting_status: AccountingBusinessEventPostingStatus;
  journal_entry_id: string | null;
  failure_reason: string | null;
  created_at: string;
}

export type PostingAccountRole =
  | "accounts_receivable"
  | "accounts_payable"
  | "revenue"
  | "cogs"
  | "inventory_asset"
  | "vat_output"
  | "vat_input"
  | "cash"
  | "bank"
  | "waste_expense"
  | "fx_gain"
  | "fx_loss"
  | "other";

export type PostingAmountField = keyof AccountingEventAmounts;

export interface PostingRuleLine {
  id: string;
  posting_rule_id: string;
  line_no: number;
  account_role: PostingAccountRole;
  side: "debit" | "credit";
  amount_field: PostingAmountField;
  tax_code: string | null;
}

export interface PostingRule {
  id: string;
  event_type: AccountingBusinessEventType;
  version: number;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  lines: PostingRuleLine[];
  created_at: string;
}

export interface AccountRoleBinding {
  id: string;
  role: PostingAccountRole;
  account_id: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
}

export type JournalEntryStatus = "draft" | "posted" | "voided";

/**
 * One balanced journal document linked to a business Transaction / event.
 * Debits must equal credits in base currency for posted entries.
 */
export interface JournalEntry {
  id: string;
  business_event_id: string | null;
  transaction_id: string | null;
  fiscal_period_id: string | null;
  entry_date: string;
  memo: string | null;
  status: JournalEntryStatus;
  transaction_currency: string;
  base_currency: string;
  exchange_rate: number;
  reversal_of_journal_entry_id: string | null;
  posted_at: string | null;
  created_at: string;
}

export interface JournalLine {
  id: string;
  journal_entry_id: string;
  line_no: number;
  account_id: string;
  description: string | null;
  debit_transaction: number;
  credit_transaction: number;
  debit_base: number;
  credit_base: number;
  tax_code: string | null;
}

/**
 * Append-only general ledger fact derived from a posted journal line.
 */
export interface LedgerEntry {
  id: string;
  journal_entry_id: string;
  journal_line_id: string;
  fiscal_period_id: string;
  account_id: string;
  entry_date: string;
  debit_base: number;
  credit_base: number;
  debit_transaction: number;
  credit_transaction: number;
  transaction_currency: string;
  base_currency: string;
  created_at: string;
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

export interface BankAccount {
  id: string;
  name: string;
  currency: string;
  account_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface CashPosition {
  currency: string;
  available_amount: number;
  pending_inbound: number;
  pending_outbound: number;
  as_of: string;
}

export interface TaxRate {
  id: string;
  name: string;
  rate: number;
  tax_code?: string;
  direction?: "input" | "output";
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
 * Statement projections that Accounting serves.
 * Reports must project from these contracts, not invent a second financial model.
 */
export type FinancialStatementType =
  | "trial_balance"
  | "balance_sheet"
  | "profit_and_loss"
  | "cash_flow"
  | "vat_return";

/**
 * Future Accounting capability surface (contracts only until roadmap phase).
 */
export type AccountingCapability =
  | "vat"
  | "taxes"
  | "bank_accounts"
  | "general_ledger"
  | "journal_entries"
  | "posting_engine"
  | "business_events"
  | "fiscal_periods"
  | "multi_currency"
  | "balance_sheet"
  | "profit_and_loss"
  | "cash_flow"
  | "fixed_assets"
  | "payroll_integration"
  | "financial_reports";
