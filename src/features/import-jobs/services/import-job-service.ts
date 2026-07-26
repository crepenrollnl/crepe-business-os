/**
 * Import Jobs metadata service (DEV-053).
 *
 * Orchestrates create_import_job, update_import_job_progress,
 * complete_import_job, and list_import_jobs only.
 * Does NOT parse files, execute imports, cache, or write tables outside those RPCs.
 */

import { MAX_NAME_LENGTH, MAX_NOTES_LENGTH } from "@/constants/limits";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  CompleteImportJobInput,
  CompleteImportJobResult,
  CreateImportJobInput,
  CreateImportJobResult,
  ImportCompleteStatus,
  ImportJob,
  ImportStatus,
  ImportType,
  UpdateImportJobProgressInput,
  UpdateImportJobProgressResult,
} from "../types/import-job";
import {
  IMPORT_COMPLETE_STATUSES,
  IMPORT_STATUSES,
  IMPORT_TYPES,
} from "../types/import-job";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rpcErrorMessage(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return typeof error === "string" ? error : null;
}

function isImportType(value: string): value is ImportType {
  return (IMPORT_TYPES as readonly string[]).includes(value);
}

function isImportStatus(value: string): value is ImportStatus {
  return (IMPORT_STATUSES as readonly string[]).includes(value);
}

function isCompleteStatus(value: string): value is ImportCompleteStatus {
  return (IMPORT_COMPLETE_STATUSES as readonly string[]).includes(value);
}

function toNullableNumber(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function validateCreateImportJobInput(
  input: CreateImportJobInput,
): string | null {
  const importType = input.import_type?.trim() ?? "";
  if (importType.length === 0) {
    return "Import type is required.";
  }
  if (!isImportType(importType)) {
    return "Import type is invalid.";
  }

  const fileName = input.file_name?.trim() ?? "";
  if (fileName.length === 0) {
    return "File name is required.";
  }
  if (fileName.length > MAX_NAME_LENGTH) {
    return `File name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  if (
    input.created_by !== undefined &&
    input.created_by !== null &&
    !UUID_RE.test(input.created_by.trim())
  ) {
    return "Created by must be a valid user id.";
  }

  if (
    input.total_rows !== undefined &&
    input.total_rows !== null &&
    (!Number.isFinite(input.total_rows) ||
      !Number.isInteger(input.total_rows) ||
      input.total_rows < 0)
  ) {
    return "Total rows is invalid.";
  }

  return null;
}

function validateUpdateImportJobProgressInput(
  input: UpdateImportJobProgressInput,
): string | null {
  if (!input.import_job_id || !UUID_RE.test(input.import_job_id.trim())) {
    return "Import job id is required.";
  }

  if (
    !Number.isFinite(input.processed_rows) ||
    !Number.isInteger(input.processed_rows) ||
    input.processed_rows < 0
  ) {
    return "Processed rows is required.";
  }

  const failedRows = input.failed_rows ?? 0;
  if (
    !Number.isFinite(failedRows) ||
    !Number.isInteger(failedRows) ||
    failedRows < 0
  ) {
    return "Failed rows is invalid.";
  }

  if (failedRows > input.processed_rows) {
    return "Failed rows cannot exceed processed rows.";
  }

  if (
    input.total_rows !== undefined &&
    input.total_rows !== null &&
    (!Number.isFinite(input.total_rows) ||
      !Number.isInteger(input.total_rows) ||
      input.total_rows < 0)
  ) {
    return "Total rows is invalid.";
  }

  return null;
}

function validateCompleteImportJobInput(
  input: CompleteImportJobInput,
): string | null {
  if (!input.import_job_id || !UUID_RE.test(input.import_job_id.trim())) {
    return "Import job id is required.";
  }

  const status = input.status ?? "completed";
  if (!isCompleteStatus(status)) {
    return "Import status is invalid.";
  }

  if (
    input.processed_rows !== undefined &&
    input.processed_rows !== null &&
    (!Number.isFinite(input.processed_rows) ||
      !Number.isInteger(input.processed_rows) ||
      input.processed_rows < 0)
  ) {
    return "Processed rows is invalid.";
  }

  if (
    input.failed_rows !== undefined &&
    input.failed_rows !== null &&
    (!Number.isFinite(input.failed_rows) ||
      !Number.isInteger(input.failed_rows) ||
      input.failed_rows < 0)
  ) {
    return "Failed rows is invalid.";
  }

  if (
    input.processed_rows !== undefined &&
    input.processed_rows !== null &&
    input.failed_rows !== undefined &&
    input.failed_rows !== null &&
    input.failed_rows > input.processed_rows
  ) {
    return "Failed rows cannot exceed processed rows.";
  }

  if (
    input.total_rows !== undefined &&
    input.total_rows !== null &&
    (!Number.isFinite(input.total_rows) ||
      !Number.isInteger(input.total_rows) ||
      input.total_rows < 0)
  ) {
    return "Total rows is invalid.";
  }

  if (status === "failed") {
    const summary = input.error_summary?.trim() ?? "";
    if (summary.length === 0) {
      return "Error summary is required.";
    }
    if (summary.length > MAX_NOTES_LENGTH) {
      return `Error summary must be ${MAX_NOTES_LENGTH} characters or fewer.`;
    }
  } else if (
    input.error_summary !== undefined &&
    input.error_summary !== null &&
    input.error_summary.trim().length > MAX_NOTES_LENGTH
  ) {
    return `Error summary must be ${MAX_NOTES_LENGTH} characters or fewer.`;
  }

  return null;
}

function mapImportRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("import type is required")) {
    return "Import type is required.";
  }

  if (normalized.includes("import type is invalid")) {
    return "Import type is invalid.";
  }

  if (normalized.includes("file name is required")) {
    return "File name is required.";
  }

  if (normalized.includes("import job id is required")) {
    return "Import job id is required.";
  }

  if (normalized.includes("import status is required")) {
    return "Import status is required.";
  }

  if (normalized.includes("import status is invalid")) {
    return "Import status is invalid.";
  }

  if (normalized.includes("import job was not found")) {
    return "Import job was not found.";
  }

  if (normalized.includes("import job is already finished")) {
    return "Import job is already finished.";
  }

  if (normalized.includes("processed rows is required")) {
    return "Processed rows is required.";
  }

  if (normalized.includes("processed rows is invalid")) {
    return "Processed rows is invalid.";
  }

  if (normalized.includes("failed rows cannot exceed processed rows")) {
    return "Failed rows cannot exceed processed rows.";
  }

  if (normalized.includes("failed rows is invalid")) {
    return "Failed rows is invalid.";
  }

  if (normalized.includes("total rows is invalid")) {
    return "Total rows is invalid.";
  }

  if (normalized.includes("error summary is required")) {
    return "Error summary is required.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("create_import_job") ||
      normalized.includes("update_import_job_progress") ||
      normalized.includes("complete_import_job") ||
      normalized.includes("list_import_jobs")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Import job management is not available yet. Apply the import jobs database script and try again.";
  }

  return null;
}

function mapImportError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapImportRpcError(message) : null;
    },
  });
}

function mapCreateImportJobResult(
  data: unknown,
): CreateImportJobResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const importJobId = row.import_job_id;
  const status = row.status;

  if (
    typeof importJobId !== "string" ||
    !UUID_RE.test(importJobId) ||
    status !== "pending"
  ) {
    return null;
  }

  return {
    importJobId,
    status: "pending",
  };
}

function mapUpdateImportJobProgressResult(
  data: unknown,
): UpdateImportJobProgressResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const importJobId = row.import_job_id;
  const status = row.status;
  const processedRows = toNumber(row.processed_rows);
  const failedRows = toNumber(row.failed_rows);
  const totalRows = toNullableNumber(row.total_rows);

  if (
    typeof importJobId !== "string" ||
    !UUID_RE.test(importJobId) ||
    status !== "running" ||
    processedRows === undefined ||
    failedRows === undefined ||
    totalRows === undefined
  ) {
    return null;
  }

  return {
    importJobId,
    status: "running",
    processedRows,
    failedRows,
    totalRows,
  };
}

function mapCompleteImportJobResult(
  data: unknown,
): CompleteImportJobResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const importJobId = row.import_job_id;
  const status = row.status;

  if (
    typeof importJobId !== "string" ||
    !UUID_RE.test(importJobId) ||
    typeof status !== "string" ||
    !isCompleteStatus(status)
  ) {
    return null;
  }

  return {
    importJobId,
    status,
  };
}

function mapImportJobRow(row: unknown): ImportJob {
  if (typeof row !== "object" || row === null) {
    throw new Error("Import job row is invalid.");
  }

  const data = row as Record<string, unknown>;
  const id = data.id;
  const importType = data.import_type;
  const fileName = data.file_name;
  const status = data.status;
  const processedRows = toNumber(data.processed_rows);
  const failedRows = toNumber(data.failed_rows);
  const totalRows = toNullableNumber(data.total_rows);
  const startedAt = nullableString(data.started_at);
  const completedAt = nullableString(data.completed_at);
  const createdBy = nullableString(data.created_by);
  const errorSummary = nullableString(data.error_summary);

  if (typeof id !== "string" || !UUID_RE.test(id)) {
    throw new Error("Import job id is invalid.");
  }

  if (typeof importType !== "string" || !isImportType(importType)) {
    throw new Error("Import job type is invalid.");
  }

  if (typeof fileName !== "string" || fileName.trim().length === 0) {
    throw new Error("Import job file name is invalid.");
  }

  if (typeof status !== "string" || !isImportStatus(status)) {
    throw new Error("Import job status is invalid.");
  }

  if (
    processedRows === undefined ||
    failedRows === undefined ||
    totalRows === undefined ||
    startedAt === undefined ||
    completedAt === undefined ||
    createdBy === undefined ||
    errorSummary === undefined
  ) {
    throw new Error("Import job row is invalid.");
  }

  if (createdBy !== null && !UUID_RE.test(createdBy)) {
    throw new Error("Import job created_by is invalid.");
  }

  return {
    id,
    importType,
    fileName,
    status,
    totalRows,
    processedRows,
    failedRows,
    startedAt,
    completedAt,
    createdBy,
    errorSummary,
  };
}

function mapListImportJobsResult(data: unknown): ImportJob[] {
  if (!Array.isArray(data)) {
    throw new Error("Import job list response is invalid.");
  }

  return data.map(mapImportJobRow);
}

export const importJobService = {
  /**
   * Create a pending import job metadata record via create_import_job RPC.
   */
  async createImportJob(
    input: CreateImportJobInput,
  ): Promise<ServiceResult<CreateImportJobResult>> {
    try {
      const validationError = validateCreateImportJobInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const { data, error } = await supabase.rpc("create_import_job", {
        p_import_type: input.import_type.trim(),
        p_file_name: input.file_name.trim(),
        p_created_by:
          input.created_by === undefined || input.created_by === null
            ? null
            : input.created_by.trim(),
        p_total_rows:
          input.total_rows === undefined ? null : input.total_rows,
      });

      if (error) {
        return fail(mapImportError(error, "Failed to create import job."));
      }

      const rpcResult = mapCreateImportJobResult(data);
      if (!rpcResult) {
        return fail("Import job created but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapImportError(error, "Failed to create import job."));
    }
  },

  /**
   * Update import job progress via update_import_job_progress RPC.
   */
  async updateImportJobProgress(
    input: UpdateImportJobProgressInput,
  ): Promise<ServiceResult<UpdateImportJobProgressResult>> {
    try {
      const validationError = validateUpdateImportJobProgressInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const { data, error } = await supabase.rpc(
        "update_import_job_progress",
        {
          p_import_job_id: input.import_job_id.trim(),
          p_processed_rows: input.processed_rows,
          p_failed_rows: input.failed_rows ?? 0,
          p_total_rows:
            input.total_rows === undefined ? null : input.total_rows,
        },
      );

      if (error) {
        return fail(
          mapImportError(error, "Failed to update import job progress."),
        );
      }

      const rpcResult = mapUpdateImportJobProgressResult(data);
      if (!rpcResult) {
        return fail(
          "Import job progress updated but the response was invalid.",
        );
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(
        mapImportError(error, "Failed to update import job progress."),
      );
    }
  },

  /**
   * Complete or fail an import job via complete_import_job RPC.
   */
  async completeImportJob(
    input: CompleteImportJobInput,
  ): Promise<ServiceResult<CompleteImportJobResult>> {
    try {
      const validationError = validateCompleteImportJobInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const { data, error } = await supabase.rpc("complete_import_job", {
        p_import_job_id: input.import_job_id.trim(),
        p_status: input.status ?? "completed",
        p_processed_rows:
          input.processed_rows === undefined ? null : input.processed_rows,
        p_failed_rows:
          input.failed_rows === undefined ? null : input.failed_rows,
        p_total_rows:
          input.total_rows === undefined ? null : input.total_rows,
        p_error_summary:
          input.error_summary === undefined ? null : input.error_summary,
      });

      if (error) {
        return fail(mapImportError(error, "Failed to complete import job."));
      }

      const rpcResult = mapCompleteImportJobResult(data);
      if (!rpcResult) {
        return fail("Import job completed but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapImportError(error, "Failed to complete import job."));
    }
  },

  /**
   * List import job metadata rows via list_import_jobs RPC.
   */
  async listImportJobs(): Promise<ServiceResult<ImportJob[]>> {
    try {
      const { data, error } = await supabase.rpc("list_import_jobs");

      if (error) {
        return fail(mapImportError(error, "Failed to load import jobs."));
      }

      try {
        return ok(mapListImportJobsResult(data));
      } catch {
        return fail("Import job list response was invalid.");
      }
    } catch (error) {
      return fail(mapImportError(error, "Failed to load import jobs."));
    }
  },
};
