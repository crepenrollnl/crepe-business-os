/**
 * Accounting feature type surface (architecture only — DEV-086).
 *
 * Accounting is the sole financial module — VAT, taxes, bank accounts,
 * GL, posting, statements, and related capabilities live here.
 *
 * Canonical architecture: docs/ACCOUNTING.md
 * Keep posting logic out until the Accounting roadmap phase.
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
  PostingAmountSource,
  PostingCurrencySource,
  PostingRule,
  PostingRuleLine,
  PostingTaxBehaviour,
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

export type {
  PostingRuleError,
  PostingRuleErrorCode,
  PostingRuleResolveResult,
  PostingRuleValidationResult,
} from "./posting-rules";
