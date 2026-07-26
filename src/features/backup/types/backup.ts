/**
 * Backup & Restore metadata contracts (DEV-052).
 *
 * Path: create_backup_record / complete_backup_record / list_backups RPCs.
 * Metadata only — no file generation, storage, or restore logic.
 */

export const BACKUP_TYPES = ["full", "incremental", "manual"] as const;

export type BackupType = (typeof BACKUP_TYPES)[number];

export const BACKUP_STATUSES = ["pending", "completed", "failed"] as const;

export type BackupStatus = (typeof BACKUP_STATUSES)[number];

export const BACKUP_COMPLETE_STATUSES = ["completed", "failed"] as const;

export type BackupCompleteStatus = (typeof BACKUP_COMPLETE_STATUSES)[number];

/**
 * Mapped backup_history row for service consumers.
 */
export interface BackupHistory {
  id: string;
  backupName: string;
  backupType: BackupType;
  createdAt: string;
  createdBy: string | null;
  fileSizeBytes: number | null;
  checksum: string | null;
  status: BackupStatus;
  notes: string | null;
}

/**
 * createBackupRecord input.
 * SQL create_backup_record owns insert + pending status.
 */
export interface CreateBackupRecordInput {
  backup_name: string;
  backup_type: BackupType;
  created_by?: string | null;
  notes?: string | null;
}

/**
 * createBackupRecord result from create_backup_record RPC.
 */
export interface CreateBackupRecordResult {
  backupId: string;
  status: "pending";
}

/**
 * completeBackupRecord input.
 * SQL complete_backup_record owns status transition + metadata fields.
 */
export interface CompleteBackupRecordInput {
  backup_id: string;
  status?: BackupCompleteStatus;
  file_size_bytes?: number | null;
  checksum?: string | null;
  notes?: string | null;
}

/**
 * completeBackupRecord result from complete_backup_record RPC.
 */
export interface CompleteBackupRecordResult {
  backupId: string;
  status: BackupCompleteStatus;
}

export type { ServiceResult } from "@/types/service";
