/**
 * Backup metadata service (DEV-052).
 *
 * Orchestrates create_backup_record, complete_backup_record, and list_backups only.
 * Does NOT generate backups, store files, restore data, cache, or write tables
 * outside those RPCs.
 */

import { MAX_NAME_LENGTH, MAX_NOTES_LENGTH } from "@/constants/limits";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  BackupCompleteStatus,
  BackupHistory,
  BackupStatus,
  BackupType,
  CompleteBackupRecordInput,
  CompleteBackupRecordResult,
  CreateBackupRecordInput,
  CreateBackupRecordResult,
} from "../types/backup";
import {
  BACKUP_COMPLETE_STATUSES,
  BACKUP_STATUSES,
  BACKUP_TYPES,
} from "../types/backup";

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

function optionalTrimmed(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isBackupType(value: string): value is BackupType {
  return (BACKUP_TYPES as readonly string[]).includes(value);
}

function isBackupStatus(value: string): value is BackupStatus {
  return (BACKUP_STATUSES as readonly string[]).includes(value);
}

function isCompleteStatus(value: string): value is BackupCompleteStatus {
  return (BACKUP_COMPLETE_STATUSES as readonly string[]).includes(value);
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

function nullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function validateCreateBackupRecordInput(
  input: CreateBackupRecordInput,
): string | null {
  const backupName = input.backup_name?.trim() ?? "";
  if (backupName.length === 0) {
    return "Backup name is required.";
  }
  if (backupName.length > MAX_NAME_LENGTH) {
    return `Backup name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  const backupType = input.backup_type?.trim() ?? "";
  if (backupType.length === 0) {
    return "Backup type is required.";
  }
  if (!isBackupType(backupType)) {
    return "Backup type is invalid.";
  }

  if (
    input.created_by !== undefined &&
    input.created_by !== null &&
    !UUID_RE.test(input.created_by.trim())
  ) {
    return "Created by must be a valid user id.";
  }

  if (input.notes !== undefined && input.notes !== null) {
    if (input.notes.trim().length > MAX_NOTES_LENGTH) {
      return `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
    }
  }

  return null;
}

function validateCompleteBackupRecordInput(
  input: CompleteBackupRecordInput,
): string | null {
  if (!input.backup_id || !UUID_RE.test(input.backup_id.trim())) {
    return "Backup id is required.";
  }

  const status = input.status ?? "completed";
  if (!isCompleteStatus(status)) {
    return "Backup status is invalid.";
  }

  if (status === "completed") {
    if (
      input.file_size_bytes === undefined ||
      input.file_size_bytes === null ||
      !Number.isFinite(input.file_size_bytes) ||
      input.file_size_bytes < 0
    ) {
      return "File size bytes is required.";
    }

    const checksum = input.checksum?.trim() ?? "";
    if (checksum.length === 0) {
      return "Checksum is required.";
    }
  } else if (
    input.file_size_bytes !== undefined &&
    input.file_size_bytes !== null &&
    (!Number.isFinite(input.file_size_bytes) || input.file_size_bytes < 0)
  ) {
    return "File size bytes is invalid.";
  }

  if (input.notes !== undefined && input.notes !== null) {
    if (input.notes.trim().length > MAX_NOTES_LENGTH) {
      return `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
    }
  }

  return null;
}

function mapBackupRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("backup name is required")) {
    return "Backup name is required.";
  }

  if (normalized.includes("backup type is required")) {
    return "Backup type is required.";
  }

  if (normalized.includes("backup type is invalid")) {
    return "Backup type is invalid.";
  }

  if (normalized.includes("backup id is required")) {
    return "Backup id is required.";
  }

  if (normalized.includes("backup status is required")) {
    return "Backup status is required.";
  }

  if (normalized.includes("backup status is invalid")) {
    return "Backup status is invalid.";
  }

  if (normalized.includes("backup was not found")) {
    return "Backup was not found.";
  }

  if (normalized.includes("backup is not pending")) {
    return "Backup is not pending.";
  }

  if (normalized.includes("file size bytes is required")) {
    return "File size bytes is required.";
  }

  if (normalized.includes("file size bytes is invalid")) {
    return "File size bytes is invalid.";
  }

  if (normalized.includes("checksum is required")) {
    return "Checksum is required.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("create_backup_record") ||
      normalized.includes("complete_backup_record") ||
      normalized.includes("list_backups")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Backup management is not available yet. Apply the backup history database script and try again.";
  }

  return null;
}

function mapBackupError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapBackupRpcError(message) : null;
    },
  });
}

function mapCreateBackupRecordResult(
  data: unknown,
): CreateBackupRecordResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const backupId = row.backup_id;
  const status = row.status;

  if (
    typeof backupId !== "string" ||
    !UUID_RE.test(backupId) ||
    status !== "pending"
  ) {
    return null;
  }

  return {
    backupId,
    status: "pending",
  };
}

function mapCompleteBackupRecordResult(
  data: unknown,
): CompleteBackupRecordResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const backupId = row.backup_id;
  const status = row.status;

  if (
    typeof backupId !== "string" ||
    !UUID_RE.test(backupId) ||
    typeof status !== "string" ||
    !isCompleteStatus(status)
  ) {
    return null;
  }

  return {
    backupId,
    status,
  };
}

function mapBackupHistoryRow(row: unknown): BackupHistory {
  if (typeof row !== "object" || row === null) {
    throw new Error("Backup history row is invalid.");
  }

  const data = row as Record<string, unknown>;
  const id = data.id;
  const backupName = data.backup_name;
  const backupType = data.backup_type;
  const createdAt = data.created_at;
  const status = data.status;

  if (typeof id !== "string" || !UUID_RE.test(id)) {
    throw new Error("Backup history id is invalid.");
  }

  if (typeof backupName !== "string" || backupName.trim().length === 0) {
    throw new Error("Backup history name is invalid.");
  }

  if (typeof backupType !== "string" || !isBackupType(backupType)) {
    throw new Error("Backup history type is invalid.");
  }

  if (typeof createdAt !== "string") {
    throw new Error("Backup history created_at is invalid.");
  }

  if (typeof status !== "string" || !isBackupStatus(status)) {
    throw new Error("Backup history status is invalid.");
  }

  const createdBy = nullableString(data.created_by);
  const fileSizeBytes = toNullableNumber(data.file_size_bytes);
  const checksum = nullableString(data.checksum);
  const notes = nullableString(data.notes);

  if (
    createdBy === undefined ||
    fileSizeBytes === undefined ||
    checksum === undefined ||
    notes === undefined
  ) {
    throw new Error("Backup history row is invalid.");
  }

  if (createdBy !== null && !UUID_RE.test(createdBy)) {
    throw new Error("Backup history created_by is invalid.");
  }

  return {
    id,
    backupName,
    backupType,
    createdAt,
    createdBy,
    fileSizeBytes,
    checksum,
    status,
    notes,
  };
}

function mapListBackupsResult(data: unknown): BackupHistory[] {
  if (!Array.isArray(data)) {
    throw new Error("Backup list response is invalid.");
  }

  return data.map(mapBackupHistoryRow);
}

export const backupService = {
  /**
   * Create a pending backup metadata record via create_backup_record RPC.
   */
  async createBackupRecord(
    input: CreateBackupRecordInput,
  ): Promise<ServiceResult<CreateBackupRecordResult>> {
    try {
      const validationError = validateCreateBackupRecordInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const { data, error } = await supabase.rpc("create_backup_record", {
        p_backup_name: input.backup_name.trim(),
        p_backup_type: input.backup_type.trim(),
        p_created_by:
          input.created_by === undefined || input.created_by === null
            ? null
            : input.created_by.trim(),
        p_notes: optionalTrimmed(input.notes),
      });

      if (error) {
        return fail(mapBackupError(error, "Failed to create backup record."));
      }

      const rpcResult = mapCreateBackupRecordResult(data);
      if (!rpcResult) {
        return fail("Backup record created but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapBackupError(error, "Failed to create backup record."));
    }
  },

  /**
   * Complete or fail a pending backup metadata record via complete_backup_record RPC.
   */
  async completeBackupRecord(
    input: CompleteBackupRecordInput,
  ): Promise<ServiceResult<CompleteBackupRecordResult>> {
    try {
      const validationError = validateCompleteBackupRecordInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const { data, error } = await supabase.rpc("complete_backup_record", {
        p_backup_id: input.backup_id.trim(),
        p_status: input.status ?? "completed",
        p_file_size_bytes:
          input.file_size_bytes === undefined ? null : input.file_size_bytes,
        p_checksum:
          input.checksum === undefined ? null : input.checksum,
        p_notes: input.notes === undefined ? null : input.notes,
      });

      if (error) {
        return fail(
          mapBackupError(error, "Failed to complete backup record."),
        );
      }

      const rpcResult = mapCompleteBackupRecordResult(data);
      if (!rpcResult) {
        return fail("Backup record completed but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapBackupError(error, "Failed to complete backup record."));
    }
  },

  /**
   * List backup metadata rows via list_backups RPC.
   */
  async listBackups(): Promise<ServiceResult<BackupHistory[]>> {
    try {
      const { data, error } = await supabase.rpc("list_backups");

      if (error) {
        return fail(mapBackupError(error, "Failed to load backups."));
      }

      try {
        return ok(mapListBackupsResult(data));
      } catch {
        return fail("Backup list response was invalid.");
      }
    } catch (error) {
      return fail(mapBackupError(error, "Failed to load backups."));
    }
  },
};
