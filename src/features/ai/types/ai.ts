/**
 * AI assistance contracts.
 * AI may propose actions; services commit validated domain changes.
 */

export type AiProposalKind =
  | "invoice_ocr"
  | "purchase_recognition"
  | "inventory_suggestion"
  | "demand_forecast";

export type AiProposalStatus = "pending_review" | "accepted" | "rejected";

export interface AiProposal<TPayload> {
  id: string;
  kind: AiProposalKind;
  status: AiProposalStatus;
  confidence: number;
  payload: TPayload;
  source_document_url: string | null;
  created_at: string;
  reviewed_at: string | null;
}
