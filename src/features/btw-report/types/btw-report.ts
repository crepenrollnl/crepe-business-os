/**
 * Quarterly NL BTW declaration (sql/095 get_btw_report).
 * Field names match the SQL JSON payload. Never recalculated in TypeScript.
 */

export type BtwBalanceDirection = "to_pay" | "to_receive" | "zero";

export interface BtwReport {
  year: number;
  quarter: number;
  period_start: string;
  period_end: string;
  rubriek_1a_revenue: number;
  rubriek_1a_vat: number;
  rubriek_1b_revenue: number;
  rubriek_1b_vat: number;
  rubriek_5a_total_vat_due: number;
  rubriek_5b_input_vat_deductible: number;
  rubriek_5c_balance: number;
  balance_direction: BtwBalanceDirection;
}
