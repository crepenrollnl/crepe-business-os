/**
 * Durable posting-failure log (audit finding #8).
 *
 * Physical operations stay committed; these rows record the non-fatal
 * Accounting posting failure that followed.
 */

export const POSTING_FAILURE_SOURCE_FLOWS = [
  "purchase_receive",
  "sale_confirm",
  "quick_sale_confirm",
  "pos_confirm",
  "production_complete",
  "write_off_record",
] as const;

export type PostingFailureSourceFlow =
  (typeof POSTING_FAILURE_SOURCE_FLOWS)[number];

export const POSTING_FAILURE_SOURCE_FLOW_LABELS: Record<
  PostingFailureSourceFlow,
  string
> = {
  purchase_receive: "Purchase receive",
  sale_confirm: "Sale confirm",
  quick_sale_confirm: "Quick sale",
  pos_confirm: "POS",
  production_complete: "Production complete",
  write_off_record: "Write-off",
};

export interface PostingFailure {
  id: string;
  occurredAt: string;
  sourceFlow: PostingFailureSourceFlow;
  entityType: string;
  entityId: string;
  businessEventId: string | null;
  errorMessage: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}

export interface ReportPostingFailureInput {
  sourceFlow: PostingFailureSourceFlow;
  entityType: string;
  entityId: string;
  businessEventId?: string | null;
  errorMessage: string;
}

export type { ServiceResult } from "@/types/service";
