/**
 * Export Jobs metadata contracts (DEV-054).
 *
 * Path: create_export_job / update_export_job_progress / complete_export_job /
 * list_export_jobs RPCs.
 * Metadata only — no file generation or export execution.
 */

export const EXPORT_TYPES = [
  "ingredients",
  "customers",
  "suppliers",
  "products",
  "recipes",
  "purchases",
  "sales",
] as const;

export type ExportType = (typeof EXPORT_TYPES)[number];

export const EXPORT_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;

export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const EXPORT_COMPLETE_STATUSES = ["completed", "failed"] as const;

export type ExportCompleteStatus = (typeof EXPORT_COMPLETE_STATUSES)[number];

/**
 * Mapped export_jobs row for service consumers.
 */
export interface ExportJob {
  id: string;
  exportType: ExportType;
  fileName: string;
  status: ExportStatus;
  totalRows: number | null;
  exportedRows: number;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string | null;
  errorSummary: string | null;
}

/**
 * createExportJob input.
 * SQL create_export_job owns insert + pending status.
 */
export interface CreateExportJobInput {
  export_type: ExportType;
  file_name: string;
  created_by?: string | null;
  total_rows?: number | null;
}

/**
 * createExportJob result from create_export_job RPC.
 */
export interface CreateExportJobResult {
  exportJobId: string;
  status: "pending";
}

/**
 * updateExportJobProgress input.
 * SQL update_export_job_progress owns running status + counters.
 */
export interface UpdateExportJobProgressInput {
  export_job_id: string;
  exported_rows: number;
  total_rows?: number | null;
}

/**
 * updateExportJobProgress result from update_export_job_progress RPC.
 */
export interface UpdateExportJobProgressResult {
  exportJobId: string;
  status: "running";
  exportedRows: number;
  totalRows: number | null;
}

/**
 * completeExportJob input.
 * SQL complete_export_job owns completed/failed transition.
 */
export interface CompleteExportJobInput {
  export_job_id: string;
  status?: ExportCompleteStatus;
  exported_rows?: number | null;
  total_rows?: number | null;
  error_summary?: string | null;
}

/**
 * completeExportJob result from complete_export_job RPC.
 */
export interface CompleteExportJobResult {
  exportJobId: string;
  status: ExportCompleteStatus;
}

export type { ServiceResult } from "@/types/service";
