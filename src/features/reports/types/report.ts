/**
 * Reports domain contracts.
 * Reports project operational and accounting data; they do not own a second ledger.
 */

export type ReportId =
  | "inventory_valuation"
  | "product_margin"
  | "sales_summary"
  | "purchase_summary"
  | "production_summary"
  | "profit_and_loss"
  | "balance_sheet"
  | "vat_return";

export interface ReportRequest {
  report_id: ReportId;
  date_from: string;
  date_to: string;
}

export interface ReportResult<TData> {
  report_id: ReportId;
  generated_at: string;
  data: TData;
}
