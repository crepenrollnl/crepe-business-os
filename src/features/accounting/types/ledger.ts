/**
 * Accounting feature re-exports shared financial contracts.
 * Accounting is the sole financial module — VAT, taxes, bank accounts,
 * GL, statements, and related capabilities live here.
 * Keep posting logic out until the Accounting roadmap phase.
 */

export type {
  Account,
  AccountType,
  AccountingCapability,
  BankAccount,
  CashPosition,
  FinancialStatementType,
  JournalEntry,
  JournalLine,
  Payment,
  PaymentDirection,
  PaymentMethod,
  TaxRate,
  VatPeriod,
  VatPeriodStatus,
} from "@/types/accounting";
