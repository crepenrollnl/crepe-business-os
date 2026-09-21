/**
 * Profit and Loss report payload from get_profit_and_loss (sql/121).
 * Field names match the SQL JSON. Never recalculated in TypeScript.
 */

export interface ProfitAndLossOpexLine {
  account_code: string;
  account_name: string;
  amount: number;
}

export interface ProfitAndLossReconciliationLine {
  operational_amount: number;
  ledger_amount: number;
  mismatch: boolean;
}

export interface ProfitAndLossReconciliation {
  sales_revenue: ProfitAndLossReconciliationLine;
  cogs: ProfitAndLossReconciliationLine;
  write_offs: ProfitAndLossReconciliationLine;
}

export interface ProfitAndLossReport {
  period_start: string;
  period_end: string;
  revenue: number;
  cogs: number;
  gross_profit: number;
  opex_breakdown: ProfitAndLossOpexLine[];
  opex: number;
  write_offs: number;
  depreciation: number;
  net_profit: number;
  reconciliation: ProfitAndLossReconciliation;
}

export type ProfitAndLossPeriodMode = "month" | "custom";
