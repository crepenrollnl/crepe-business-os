/**
 * Service-level coverage for backupService (DEV-052).
 *
 * create / complete / list must go only through SQL RPCs.
 * The service must not generate files, restore data, or write backup_history directly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_NAME_LENGTH } from "@/constants/limits";

const { supabaseMock } = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  };
  return { supabaseMock };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { backupService } from "./backup-service";
import type {
  BackupHistory,
  CompleteBackupRecordResult,
  CreateBackupRecordResult,
} from "../types/backup";

const BACKUP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BACKUP_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function backupRow(overrides?: Record<string, unknown>) {
  return {
    id: BACKUP_ID,
    backup_name: "nightly-full",
    backup_type: "full",
    created_at: "2026-07-25T16:00:00.000Z",
    created_by: null,
    file_size_bytes: null,
    checksum: null,
    status: "pending",
    notes: null,
    ...overrides,
  };
}

function expectNoDirectWrites() {
  expect(supabaseMock.from).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

describe("backupService (DEV-052)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    supabaseMock.from.mockImplementation(() => ({
      select: vi.fn(),
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    }));
  });

  describe("createBackupRecord", () => {
    it("creates a pending backup record successfully", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          backup_id: BACKUP_ID,
          status: "pending",
        },
        error: null,
      });

      const result = await backupService.createBackupRecord({
        backup_name: "  nightly-full  ",
        backup_type: "full",
        created_by: USER_ID,
        notes: " Nightly run ",
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        backupId: BACKUP_ID,
        status: "pending",
      } satisfies CreateBackupRecordResult);
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("create_backup_record", {
        p_backup_name: "nightly-full",
        p_backup_type: "full",
        p_created_by: USER_ID,
        p_notes: "Nightly run",
      });
      expectNoDirectWrites();
    });

    it("rejects missing backup name without calling the RPC", async () => {
      const result = await backupService.createBackupRecord({
        backup_name: "   ",
        backup_type: "full",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Backup name is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expectNoDirectWrites();
    });

    it("rejects invalid backup type without calling the RPC", async () => {
      const result = await backupService.createBackupRecord({
        backup_name: "nightly-full",
        backup_type: "partial" as "full",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Backup type is invalid.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects oversized backup name without calling the RPC", async () => {
      const result = await backupService.createBackupRecord({
        backup_name: "A".repeat(MAX_NAME_LENGTH + 1),
        backup_type: "manual",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        `Backup name must be ${MAX_NAME_LENGTH} characters or fewer.`,
      );
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("maps missing create_backup_record function errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Could not find the function public.create_backup_record",
        },
      });

      const result = await backupService.createBackupRecord({
        backup_name: "nightly-full",
        backup_type: "full",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Backup management is not available yet. Apply the backup history database script and try again.",
      );
      expectNoDirectWrites();
    });

    it("never writes backup_history directly on create", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { backup_id: BACKUP_ID, status: "pending" },
        error: null,
      });

      await backupService.createBackupRecord({
        backup_name: "nightly-full",
        backup_type: "full",
      });

      expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
        "create_backup_record",
      ]);
      expectNoDirectWrites();
    });
  });

  describe("completeBackupRecord", () => {
    it("completes a backup record successfully", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          backup_id: BACKUP_ID,
          status: "completed",
        },
        error: null,
      });

      const result = await backupService.completeBackupRecord({
        backup_id: BACKUP_ID,
        status: "completed",
        file_size_bytes: 1024,
        checksum: "abc123",
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        backupId: BACKUP_ID,
        status: "completed",
      } satisfies CompleteBackupRecordResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("complete_backup_record", {
        p_backup_id: BACKUP_ID,
        p_status: "completed",
        p_file_size_bytes: 1024,
        p_checksum: "abc123",
        p_notes: null,
      });
      expectNoDirectWrites();
    });

    it("fails a backup record successfully", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          backup_id: BACKUP_ID,
          status: "failed",
        },
        error: null,
      });

      const result = await backupService.completeBackupRecord({
        backup_id: BACKUP_ID,
        status: "failed",
        notes: "Disk full",
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        backupId: BACKUP_ID,
        status: "failed",
      } satisfies CompleteBackupRecordResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("complete_backup_record", {
        p_backup_id: BACKUP_ID,
        p_status: "failed",
        p_file_size_bytes: null,
        p_checksum: null,
        p_notes: "Disk full",
      });
      expectNoDirectWrites();
    });

    it("rejects invalid backup id without calling the RPC", async () => {
      const result = await backupService.completeBackupRecord({
        backup_id: "bad-id",
        file_size_bytes: 10,
        checksum: "abc",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Backup id is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects completed status without file size or checksum", async () => {
      const missingSize = await backupService.completeBackupRecord({
        backup_id: BACKUP_ID,
        status: "completed",
        checksum: "abc",
      });
      expect(missingSize.data).toBeNull();
      expect(missingSize.error).toBe("File size bytes is required.");

      const missingChecksum = await backupService.completeBackupRecord({
        backup_id: BACKUP_ID,
        status: "completed",
        file_size_bytes: 10,
        checksum: "   ",
      });
      expect(missingChecksum.data).toBeNull();
      expect(missingChecksum.error).toBe("Checksum is required.");

      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("maps not-pending RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Backup is not pending.",
        },
      });

      const result = await backupService.completeBackupRecord({
        backup_id: BACKUP_ID,
        file_size_bytes: 10,
        checksum: "abc",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Backup is not pending.");
    });

    it("maps not-found RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Backup was not found.",
        },
      });

      const result = await backupService.completeBackupRecord({
        backup_id: BACKUP_ID,
        file_size_bytes: 10,
        checksum: "abc",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Backup was not found.");
      expectNoDirectWrites();
    });
  });

  describe("listBackups", () => {
    it("maps backup rows to typed DTOs in RPC order", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: [
          backupRow({
            id: BACKUP_ID_2,
            backup_name: "newer",
            created_at: "2026-07-25T17:00:00.000Z",
            status: "completed",
            file_size_bytes: 2048,
            checksum: "def456",
          }),
          backupRow({
            id: BACKUP_ID,
            backup_name: "older",
            created_at: "2026-07-25T16:00:00.000Z",
            status: "pending",
          }),
        ],
        error: null,
      });

      const result = await backupService.listBackups();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([
        {
          id: BACKUP_ID_2,
          backupName: "newer",
          backupType: "full",
          createdAt: "2026-07-25T17:00:00.000Z",
          createdBy: null,
          fileSizeBytes: 2048,
          checksum: "def456",
          status: "completed",
          notes: null,
        },
        {
          id: BACKUP_ID,
          backupName: "older",
          backupType: "full",
          createdAt: "2026-07-25T16:00:00.000Z",
          createdBy: null,
          fileSizeBytes: null,
          checksum: null,
          status: "pending",
          notes: null,
        },
      ] satisfies BackupHistory[]);
      expect(result.data?.[0]?.createdAt).toBe("2026-07-25T17:00:00.000Z");
      expect(result.data?.[1]?.createdAt).toBe("2026-07-25T16:00:00.000Z");
      expect(supabaseMock.rpc).toHaveBeenCalledWith("list_backups");
      expectNoDirectWrites();
    });

    it("returns an empty array when history is empty", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await backupService.listBackups();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([] satisfies BackupHistory[]);
      expectNoDirectWrites();
    });

    it("is read-only and never writes tables", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: [backupRow()],
        error: null,
      });

      await backupService.listBackups();

      expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
        "list_backups",
      ]);
      expectNoDirectWrites();
    });

    it("maps missing list_backups function errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Could not find the function public.list_backups",
        },
      });

      const result = await backupService.listBackups();

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Backup management is not available yet. Apply the backup history database script and try again.",
      );
    });

    it("rejects invalid list payloads", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { not: "an-array" },
        error: null,
      });

      const result = await backupService.listBackups();

      expect(result.data).toBeNull();
      expect(result.error).toBe("Backup list response was invalid.");
    });
  });
});
