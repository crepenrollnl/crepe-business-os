/**
 * Accounting types barrel (architecture only — DEV-086).
 */

export type {
  Account,
  AccountRoleBinding,
  AccountType,
  AccountingBusinessEvent,
  AccountingBusinessEventPostingStatus,
  AccountingBusinessEventType,
  AccountingCapability,
  AccountingEventAmounts,
  AccountingEventTaxLine,
  BankAccount,
  CashPosition,
  CurrencyRate,
  FinancialStatementType,
  FiscalPeriod,
  FiscalPeriodStatus,
  JournalEntry,
  JournalEntryStatus,
  JournalLine,
  LedgerEntry,
  Payment,
  PaymentDirection,
  PaymentMethod,
  PostingAccountRole,
  PostingAmountField,
  PostingRule,
  PostingRuleLine,
  TaxRate,
  VatPeriod,
  VatPeriodStatus,
} from "@/types/accounting";

export type {
  PostingContext,
  PostingError,
  PostingErrorCode,
  PostingPipelineResult,
  PostingResult,
} from "./posting-engine";
