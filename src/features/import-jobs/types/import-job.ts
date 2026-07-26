/**
 * Import Jobs metadata contracts (DEV-053).
 *
 * Path: create_import_job / update_import_job_progress / complete_import_job /
 * list_import_jobs RPCs.
 * Metadata only — no file parsing or import execution.
 */

export const IMPORT_TYPES = [
  "ingredients",
  "customers",
  "suppliers",
  "products",
  "recipes",
  "purchases",
  "sales",
] as const;

export type ImportType = (typeof IMPORT_TYPES)[number];

export const IMPORT_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;

export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const IMPORT_COMPLETE_STATUSES = ["completed", "failed"] as const;

export type ImportCompleteStatus = (typeof IMPORT_COMPLETE_STATUSES)[number];

/**
 * Mapped import_jobs row for service consumers.
 */
export interface ImportJob {
  id: string;
  importType: ImportType;
  fileName: string;
  status: ImportStatus;
  totalRows: number | null;
  processedRows: number;
  failedRows: number;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string | null;
  errorSummary: string | null;
}

/**
 * createImportJob input.
 * SQL create_import_job owns insert + pending status.
 */
export interface CreateImportJobInput {
  import_type: ImportType;
  file_name: string;
  created_by?: string | null;
  total_rows?: number | null;
}

/**
 * createImportJob result from create_import_job RPC.
 */
export interface CreateImportJobResult {
  importJobId: string;
  status: "pending";
}

/**
 * updateImportJobProgress input.
 * SQL update_import_job_progress owns running status + counters.
 */
export interface UpdateImportJobProgressInput {
  import_job_id: string;
  processed_rows: number;
  failed_rows?: number;
  total_rows?: number | null;
}

/**
 * updateImportJobProgress result from update_import_job_progress RPC.
 */
export interface UpdateImportJobProgressResult {
  importJobId: string;
  status: "running";
  processedRows: number;
  failedRows: number;
  totalRows: number | null;
}

/**
 * completeImportJob input.
 * SQL complete_import_job owns completed/failed transition.
 */
export interface CompleteImportJobInput {
  import_job_id: string;
  status?: ImportCompleteStatus;
  processed_rows?: number | null;
  failed_rows?: number | null;
  total_rows?: number | null;
  error_summary?: string | null;
}

/**
 * completeImportJob result from complete_import_job RPC.
 */
export interface CompleteImportJobResult {
  importJobId: string;
  status: ImportCompleteStatus;
}

export type { ServiceResult } from "@/types/service";
