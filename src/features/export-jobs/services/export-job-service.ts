/**
 * Export Jobs metadata service (DEV-054).
 *
 * Orchestrates create_export_job, update_export_job_progress,
 * complete_export_job, and list_export_jobs only.
 * Does NOT generate files, execute exports, cache, or write tables outside those RPCs.
 */

import { MAX_NAME_LENGTH, MAX_NOTES_LENGTH } from "@/constants/limits";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  CompleteExportJobInput,
  CompleteExportJobResult,
  CreateExportJobInput,
  CreateExportJobResult,
  ExportCompleteStatus,
  ExportJob,
  ExportStatus,
  ExportType,
  UpdateExportJobProgressInput,
  UpdateExportJobProgressResult,
} from "../types/export-job";
import {
  EXPORT_COMPLETE_STATUSES,
  EXPORT_STATUSES,
  EXPORT_TYPES,
} from "../types/export-job";

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

function isExportType(value: string): value is ExportType {
  return (EXPORT_TYPES as readonly string[]).includes(value);
}

function isExportStatus(value: string): value is ExportStatus {
  return (EXPORT_STATUSES as readonly string[]).includes(value);
}

function isCompleteStatus(value: string): value is ExportCompleteStatus {
  return (EXPORT_COMPLETE_STATUSES as readonly string[]).includes(value);
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

function validateCreateExportJobInput(
  input: CreateExportJobInput,
): string | null {
  const exportType = input.export_type?.trim() ?? "";
  if (exportType.length === 0) {
    return "Export type is required.";
  }
  if (!isExportType(exportType)) {
    return "Export type is invalid.";
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

function validateUpdateExportJobProgressInput(
  input: UpdateExportJobProgressInput,
): string | null {
  if (!input.export_job_id || !UUID_RE.test(input.export_job_id.trim())) {
    return "Export job id is required.";
  }

  if (
    !Number.isFinite(input.exported_rows) ||
    !Number.isInteger(input.exported_rows) ||
    input.exported_rows < 0
  ) {
    return "Exported rows is required.";
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

  if (
    input.total_rows !== undefined &&
    input.total_rows !== null &&
    input.exported_rows > input.total_rows
  ) {
    return "Exported rows cannot exceed total rows.";
  }

  return null;
}

function validateCompleteExportJobInput(
  input: CompleteExportJobInput,
): string | null {
  if (!input.export_job_id || !UUID_RE.test(input.export_job_id.trim())) {
    return "Export job id is required.";
  }

  const status = input.status ?? "completed";
  if (!isCompleteStatus(status)) {
    return "Export status is invalid.";
  }

  if (
    input.exported_rows !== undefined &&
    input.exported_rows !== null &&
    (!Number.isFinite(input.exported_rows) ||
      !Number.isInteger(input.exported_rows) ||
      input.exported_rows < 0)
  ) {
    return "Exported rows is invalid.";
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

  if (
    input.exported_rows !== undefined &&
    input.exported_rows !== null &&
    input.total_rows !== undefined &&
    input.total_rows !== null &&
    input.exported_rows > input.total_rows
  ) {
    return "Exported rows cannot exceed total rows.";
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

function mapExportRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("export type is required")) {
    return "Export type is required.";
  }

  if (normalized.includes("export type is invalid")) {
    return "Export type is invalid.";
  }

  if (normalized.includes("file name is required")) {
    return "File name is required.";
  }

  if (normalized.includes("export job id is required")) {
    return "Export job id is required.";
  }

  if (normalized.includes("export status is required")) {
    return "Export status is required.";
  }

  if (normalized.includes("export status is invalid")) {
    return "Export status is invalid.";
  }

  if (normalized.includes("export job was not found")) {
    return "Export job was not found.";
  }

  if (normalized.includes("export job is already finished")) {
    return "Export job is already finished.";
  }

  if (normalized.includes("exported rows is required")) {
    return "Exported rows is required.";
  }

  if (normalized.includes("exported rows is invalid")) {
    return "Exported rows is invalid.";
  }

  if (normalized.includes("exported rows cannot exceed total rows")) {
    return "Exported rows cannot exceed total rows.";
  }

  if (normalized.includes("total rows is invalid")) {
    return "Total rows is invalid.";
  }

  if (normalized.includes("error summary is required")) {
    return "Error summary is required.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("create_export_job") ||
      normalized.includes("update_export_job_progress") ||
      normalized.includes("complete_export_job") ||
      normalized.includes("list_export_jobs")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Export job management is not available yet. Apply the export jobs database script and try again.";
  }

  return null;
}

function mapExportError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapExportRpcError(message) : null;
    },
  });
}

function mapCreateExportJobResult(
  data: unknown,
): CreateExportJobResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const exportJobId = row.export_job_id;
  const status = row.status;

  if (
    typeof exportJobId !== "string" ||
    !UUID_RE.test(exportJobId) ||
    status !== "pending"
  ) {
    return null;
  }

  return {
    exportJobId,
    status: "pending",
  };
}

function mapUpdateExportJobProgressResult(
  data: unknown,
): UpdateExportJobProgressResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const exportJobId = row.export_job_id;
  const status = row.status;
  const exportedRows = toNumber(row.exported_rows);
  const totalRows = toNullableNumber(row.total_rows);

  if (
    typeof exportJobId !== "string" ||
    !UUID_RE.test(exportJobId) ||
    status !== "running" ||
    exportedRows === undefined ||
    totalRows === undefined
  ) {
    return null;
  }

  return {
    exportJobId,
    status: "running",
    exportedRows,
    totalRows,
  };
}

function mapCompleteExportJobResult(
  data: unknown,
): CompleteExportJobResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const exportJobId = row.export_job_id;
  const status = row.status;

  if (
    typeof exportJobId !== "string" ||
    !UUID_RE.test(exportJobId) ||
    typeof status !== "string" ||
    !isCompleteStatus(status)
  ) {
    return null;
  }

  return {
    exportJobId,
    status,
  };
}

function mapExportJobRow(row: unknown): ExportJob {
  if (typeof row !== "object" || row === null) {
    throw new Error("Export job row is invalid.");
  }

  const data = row as Record<string, unknown>;
  const id = data.id;
  const exportType = data.export_type;
  const fileName = data.file_name;
  const status = data.status;
  const exportedRows = toNumber(data.exported_rows);
  const totalRows = toNullableNumber(data.total_rows);
  const startedAt = nullableString(data.started_at);
  const completedAt = nullableString(data.completed_at);
  const createdBy = nullableString(data.created_by);
  const errorSummary = nullableString(data.error_summary);

  if (typeof id !== "string" || !UUID_RE.test(id)) {
    throw new Error("Export job id is invalid.");
  }

  if (typeof exportType !== "string" || !isExportType(exportType)) {
    throw new Error("Export job type is invalid.");
  }

  if (typeof fileName !== "string" || fileName.trim().length === 0) {
    throw new Error("Export job file name is invalid.");
  }

  if (typeof status !== "string" || !isExportStatus(status)) {
    throw new Error("Export job status is invalid.");
  }

  if (
    exportedRows === undefined ||
    totalRows === undefined ||
    startedAt === undefined ||
    completedAt === undefined ||
    createdBy === undefined ||
    errorSummary === undefined
  ) {
    throw new Error("Export job row is invalid.");
  }

  if (createdBy !== null && !UUID_RE.test(createdBy)) {
    throw new Error("Export job created_by is invalid.");
  }

  return {
    id,
    exportType,
    fileName,
    status,
    totalRows,
    exportedRows,
    startedAt,
    completedAt,
    createdBy,
    errorSummary,
  };
}

function mapListExportJobsResult(data: unknown): ExportJob[] {
  if (!Array.isArray(data)) {
    throw new Error("Export job list response is invalid.");
  }

  return data.map(mapExportJobRow);
}

export const exportJobService = {
  /**
   * Create a pending export job metadata record via create_export_job RPC.
   */
  async createExportJob(
    input: CreateExportJobInput,
  ): Promise<ServiceResult<CreateExportJobResult>> {
    try {
      const validationError = validateCreateExportJobInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const { data, error } = await supabase.rpc("create_export_job", {
        p_export_type: input.export_type.trim(),
        p_file_name: input.file_name.trim(),
        p_created_by:
          input.created_by === undefined || input.created_by === null
            ? null
            : input.created_by.trim(),
        p_total_rows:
          input.total_rows === undefined ? null : input.total_rows,
      });

      if (error) {
        return fail(mapExportError(error, "Failed to create export job."));
      }

      const rpcResult = mapCreateExportJobResult(data);
      if (!rpcResult) {
        return fail("Export job created but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapExportError(error, "Failed to create export job."));
    }
  },

  /**
   * Update export job progress via update_export_job_progress RPC.
   */
  async updateExportJobProgress(
    input: UpdateExportJobProgressInput,
  ): Promise<ServiceResult<UpdateExportJobProgressResult>> {
    try {
      const validationError = validateUpdateExportJobProgressInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const { data, error } = await supabase.rpc(
        "update_export_job_progress",
        {
          p_export_job_id: input.export_job_id.trim(),
          p_exported_rows: input.exported_rows,
          p_total_rows:
            input.total_rows === undefined ? null : input.total_rows,
        },
      );

      if (error) {
        return fail(
          mapExportError(error, "Failed to update export job progress."),
        );
      }

      const rpcResult = mapUpdateExportJobProgressResult(data);
      if (!rpcResult) {
        return fail(
          "Export job progress updated but the response was invalid.",
        );
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(
        mapExportError(error, "Failed to update export job progress."),
      );
    }
  },

  /**
   * Complete or fail an export job via complete_export_job RPC.
   */
  async completeExportJob(
    input: CompleteExportJobInput,
  ): Promise<ServiceResult<CompleteExportJobResult>> {
    try {
      const validationError = validateCompleteExportJobInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const { data, error } = await supabase.rpc("complete_export_job", {
        p_export_job_id: input.export_job_id.trim(),
        p_status: input.status ?? "completed",
        p_exported_rows:
          input.exported_rows === undefined ? null : input.exported_rows,
        p_total_rows:
          input.total_rows === undefined ? null : input.total_rows,
        p_error_summary:
          input.error_summary === undefined ? null : input.error_summary,
      });

      if (error) {
        return fail(mapExportError(error, "Failed to complete export job."));
      }

      const rpcResult = mapCompleteExportJobResult(data);
      if (!rpcResult) {
        return fail("Export job completed but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapExportError(error, "Failed to complete export job."));
    }
  },

  /**
   * List export job metadata rows via list_export_jobs RPC.
   */
  async listExportJobs(): Promise<ServiceResult<ExportJob[]>> {
    try {
      const { data, error } = await supabase.rpc("list_export_jobs");

      if (error) {
        return fail(mapExportError(error, "Failed to load export jobs."));
      }

      try {
        return ok(mapListExportJobsResult(data));
      } catch {
        return fail("Export job list response was invalid.");
      }
    } catch (error) {
      return fail(mapExportError(error, "Failed to load export jobs."));
    }
  },
};
