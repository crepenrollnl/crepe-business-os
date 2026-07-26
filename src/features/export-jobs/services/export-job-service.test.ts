/**
 * Service-level coverage for exportJobService (DEV-054).
 *
 * create / progress / complete / list must go only through SQL RPCs.
 * The service must not generate files, execute exports, or write export_jobs directly.
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

import { exportJobService } from "./export-job-service";
import type {
  CompleteExportJobResult,
  CreateExportJobResult,
  ExportJob,
  UpdateExportJobProgressResult,
} from "../types/export-job";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function exportJobRow(overrides?: Record<string, unknown>) {
  return {
    id: JOB_ID,
    export_type: "ingredients",
    file_name: "ingredients-export.csv",
    status: "pending",
    total_rows: 100,
    exported_rows: 0,
    started_at: null,
    completed_at: null,
    created_by: null,
    error_summary: null,
    ...overrides,
  };
}

function expectNoDirectWrites() {
  expect(supabaseMock.from).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

describe("exportJobService (DEV-054)", () => {
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

  describe("createExportJob", () => {
    it("creates a pending export job successfully", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          export_job_id: JOB_ID,
          status: "pending",
        },
        error: null,
      });

      const result = await exportJobService.createExportJob({
        export_type: "ingredients",
        file_name: "  ingredients-export.csv  ",
        created_by: USER_ID,
        total_rows: 100,
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        exportJobId: JOB_ID,
        status: "pending",
      } satisfies CreateExportJobResult);
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("create_export_job", {
        p_export_type: "ingredients",
        p_file_name: "ingredients-export.csv",
        p_created_by: USER_ID,
        p_total_rows: 100,
      });
      expectNoDirectWrites();
    });

    it("rejects missing file name without calling the RPC", async () => {
      const result = await exportJobService.createExportJob({
        export_type: "customers",
        file_name: "   ",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("File name is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expectNoDirectWrites();
    });

    it("rejects invalid export type without calling the RPC", async () => {
      const result = await exportJobService.createExportJob({
        export_type: "widgets" as "ingredients",
        file_name: "widgets.csv",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Export type is invalid.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects oversized file name without calling the RPC", async () => {
      const result = await exportJobService.createExportJob({
        export_type: "ingredients",
        file_name: `${"A".repeat(MAX_NAME_LENGTH + 1)}.csv`,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        `File name must be ${MAX_NAME_LENGTH} characters or fewer.`,
      );
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("maps missing create_export_job function errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Could not find the function public.create_export_job",
        },
      });

      const result = await exportJobService.createExportJob({
        export_type: "ingredients",
        file_name: "ingredients-export.csv",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Export job management is not available yet. Apply the export jobs database script and try again.",
      );
      expectNoDirectWrites();
    });

    it("never writes export_jobs directly on create", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { export_job_id: JOB_ID, status: "pending" },
        error: null,
      });

      await exportJobService.createExportJob({
        export_type: "ingredients",
        file_name: "ingredients-export.csv",
      });

      expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
        "create_export_job",
      ]);
      expectNoDirectWrites();
    });
  });

  describe("updateExportJobProgress", () => {
    it("updates progress successfully and returns a typed result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          export_job_id: JOB_ID,
          status: "running",
          exported_rows: 40,
          total_rows: 100,
        },
        error: null,
      });

      const result = await exportJobService.updateExportJobProgress({
        export_job_id: JOB_ID,
        exported_rows: 40,
        total_rows: 100,
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        exportJobId: JOB_ID,
        status: "running",
        exportedRows: 40,
        totalRows: 100,
      } satisfies UpdateExportJobProgressResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith(
        "update_export_job_progress",
        {
          p_export_job_id: JOB_ID,
          p_exported_rows: 40,
          p_total_rows: 100,
        },
      );
      expectNoDirectWrites();
    });

    it("sends null total_rows when omitted", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          export_job_id: JOB_ID,
          status: "running",
          exported_rows: 10,
          total_rows: null,
        },
        error: null,
      });

      const result = await exportJobService.updateExportJobProgress({
        export_job_id: JOB_ID,
        exported_rows: 10,
      });

      expect(result.error).toBeNull();
      expect(supabaseMock.rpc).toHaveBeenCalledWith(
        "update_export_job_progress",
        {
          p_export_job_id: JOB_ID,
          p_exported_rows: 10,
          p_total_rows: null,
        },
      );
    });

    it("rejects invalid job id and row counts without calling the RPC", async () => {
      const badId = await exportJobService.updateExportJobProgress({
        export_job_id: "bad-id",
        exported_rows: 1,
      });
      expect(badId.data).toBeNull();
      expect(badId.error).toBe("Export job id is required.");

      const badExported = await exportJobService.updateExportJobProgress({
        export_job_id: JOB_ID,
        exported_rows: 101,
        total_rows: 100,
      });
      expect(badExported.data).toBeNull();
      expect(badExported.error).toBe(
        "Exported rows cannot exceed total rows.",
      );

      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("maps already-finished RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Export job is already finished.",
        },
      });

      const result = await exportJobService.updateExportJobProgress({
        export_job_id: JOB_ID,
        exported_rows: 1,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Export job is already finished.");
      expectNoDirectWrites();
    });
  });

  describe("completeExportJob", () => {
    it("completes an export job successfully", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          export_job_id: JOB_ID,
          status: "completed",
        },
        error: null,
      });

      const result = await exportJobService.completeExportJob({
        export_job_id: JOB_ID,
        status: "completed",
        exported_rows: 100,
        total_rows: 100,
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        exportJobId: JOB_ID,
        status: "completed",
      } satisfies CompleteExportJobResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("complete_export_job", {
        p_export_job_id: JOB_ID,
        p_status: "completed",
        p_exported_rows: 100,
        p_total_rows: 100,
        p_error_summary: null,
      });
      expectNoDirectWrites();
    });

    it("fails an export job successfully", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          export_job_id: JOB_ID,
          status: "failed",
        },
        error: null,
      });

      const result = await exportJobService.completeExportJob({
        export_job_id: JOB_ID,
        status: "failed",
        exported_rows: 20,
        error_summary: "Disk full",
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        exportJobId: JOB_ID,
        status: "failed",
      } satisfies CompleteExportJobResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("complete_export_job", {
        p_export_job_id: JOB_ID,
        p_status: "failed",
        p_exported_rows: 20,
        p_total_rows: null,
        p_error_summary: "Disk full",
      });
      expectNoDirectWrites();
    });

    it("rejects failed completion without error summary", async () => {
      const result = await exportJobService.completeExportJob({
        export_job_id: JOB_ID,
        status: "failed",
        error_summary: "   ",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Error summary is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("maps not-found RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Export job was not found.",
        },
      });

      const result = await exportJobService.completeExportJob({
        export_job_id: JOB_ID,
        status: "completed",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Export job was not found.");
    });
  });

  describe("listExportJobs", () => {
    it("maps export jobs to typed DTOs in RPC order", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: [
          exportJobRow({
            id: JOB_ID_2,
            export_type: "customers",
            file_name: "customers-export.csv",
            status: "completed",
            total_rows: 50,
            exported_rows: 50,
            started_at: "2026-07-25T17:00:00.000Z",
            completed_at: "2026-07-25T17:05:00.000Z",
          }),
          exportJobRow({
            id: JOB_ID,
            export_type: "ingredients",
            file_name: "ingredients-export.csv",
            status: "pending",
            total_rows: 100,
            exported_rows: 0,
            started_at: null,
            completed_at: null,
          }),
        ],
        error: null,
      });

      const result = await exportJobService.listExportJobs();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([
        {
          id: JOB_ID_2,
          exportType: "customers",
          fileName: "customers-export.csv",
          status: "completed",
          totalRows: 50,
          exportedRows: 50,
          startedAt: "2026-07-25T17:00:00.000Z",
          completedAt: "2026-07-25T17:05:00.000Z",
          createdBy: null,
          errorSummary: null,
        },
        {
          id: JOB_ID,
          exportType: "ingredients",
          fileName: "ingredients-export.csv",
          status: "pending",
          totalRows: 100,
          exportedRows: 0,
          startedAt: null,
          completedAt: null,
          createdBy: null,
          errorSummary: null,
        },
      ] satisfies ExportJob[]);
      expect(result.data?.[0]?.startedAt).toBe("2026-07-25T17:00:00.000Z");
      expect(result.data?.[1]?.startedAt).toBeNull();
      expect(supabaseMock.rpc).toHaveBeenCalledWith("list_export_jobs");
      expectNoDirectWrites();
    });

    it("returns an empty array when history is empty", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await exportJobService.listExportJobs();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([] satisfies ExportJob[]);
      expectNoDirectWrites();
    });

    it("is read-only and never writes tables", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: [exportJobRow()],
        error: null,
      });

      await exportJobService.listExportJobs();

      expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
        "list_export_jobs",
      ]);
      expectNoDirectWrites();
    });

    it("maps missing list_export_jobs function errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Could not find the function public.list_export_jobs",
        },
      });

      const result = await exportJobService.listExportJobs();

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Export job management is not available yet. Apply the export jobs database script and try again.",
      );
    });

    it("rejects invalid list payloads", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { not: "an-array" },
        error: null,
      });

      const result = await exportJobService.listExportJobs();

      expect(result.data).toBeNull();
      expect(result.error).toBe("Export job list response was invalid.");
    });
  });
});
