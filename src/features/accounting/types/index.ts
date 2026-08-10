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

export type {
  JournalProposal,
  PostedJournalRecord,
  PostingPersistenceError,
  PostingPersistenceErrorCode,
  PostingPersistenceValidationResult,
} from "./posting-persistence";

export type {
  OperationalBusinessEvent,
  OperationalPostingContext,
  OperationalPostingMetadata,
  OperationalPostingMode,
  OperationalPostingRequest,
  OperationalPostingResult,
} from "./operational-integration";
