/**
 * Service-level coverage for importJobService (DEV-053).
 *
 * create / progress / complete / list must go only through SQL RPCs.
 * The service must not parse files, execute imports, or write import_jobs directly.
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

import { importJobService } from "./import-job-service";
import type {
  CompleteImportJobResult,
  CreateImportJobResult,
  ImportJob,
  UpdateImportJobProgressResult,
} from "../types/import-job";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function importJobRow(overrides?: Record<string, unknown>) {
  return {
    id: JOB_ID,
    import_type: "ingredients",
    file_name: "ingredients.csv",
    status: "pending",
    total_rows: 100,
    processed_rows: 0,
    failed_rows: 0,
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

describe("importJobService (DEV-053)", () => {
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

  describe("createImportJob", () => {
    it("creates a pending import job successfully", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          import_job_id: JOB_ID,
          status: "pending",
        },
        error: null,
      });

      const result = await importJobService.createImportJob({
        import_type: "ingredients",
        file_name: "  ingredients.csv  ",
        created_by: USER_ID,
        total_rows: 100,
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        importJobId: JOB_ID,
        status: "pending",
      } satisfies CreateImportJobResult);
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("create_import_job", {
        p_import_type: "ingredients",
        p_file_name: "ingredients.csv",
        p_created_by: USER_ID,
        p_total_rows: 100,
      });
      expectNoDirectWrites();
    });

    it("rejects missing file name without calling the RPC", async () => {
      const result = await importJobService.createImportJob({
        import_type: "customers",
        file_name: "   ",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("File name is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expectNoDirectWrites();
    });

    it("rejects invalid import type without calling the RPC", async () => {
      const result = await importJobService.createImportJob({
        import_type: "widgets" as "ingredients",
        file_name: "widgets.csv",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Import type is invalid.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects oversized file name without calling the RPC", async () => {
      const result = await importJobService.createImportJob({
        import_type: "ingredients",
        file_name: `${"A".repeat(MAX_NAME_LENGTH + 1)}.csv`,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        `File name must be ${MAX_NAME_LENGTH} characters or fewer.`,
      );
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("maps missing create_import_job function errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Could not find the function public.create_import_job",
        },
      });

      const result = await importJobService.createImportJob({
        import_type: "ingredients",
        file_name: "ingredients.csv",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Import job management is not available yet. Apply the import jobs database script and try again.",
      );
      expectNoDirectWrites();
    });

    it("never writes import_jobs directly on create", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { import_job_id: JOB_ID, status: "pending" },
        error: null,
      });

      await importJobService.createImportJob({
        import_type: "ingredients",
        file_name: "ingredients.csv",
      });

      expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
        "create_import_job",
      ]);
      expectNoDirectWrites();
    });
  });

  describe("updateImportJobProgress", () => {
    it("updates progress successfully and returns a typed result", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          import_job_id: JOB_ID,
          status: "running",
          processed_rows: 40,
          failed_rows: 2,
          total_rows: 100,
        },
        error: null,
      });

      const result = await importJobService.updateImportJobProgress({
        import_job_id: JOB_ID,
        processed_rows: 40,
        failed_rows: 2,
        total_rows: 100,
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        importJobId: JOB_ID,
        status: "running",
        processedRows: 40,
        failedRows: 2,
        totalRows: 100,
      } satisfies UpdateImportJobProgressResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith(
        "update_import_job_progress",
        {
          p_import_job_id: JOB_ID,
          p_processed_rows: 40,
          p_failed_rows: 2,
          p_total_rows: 100,
        },
      );
      expectNoDirectWrites();
    });

    it("defaults failed_rows to 0 when omitted", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          import_job_id: JOB_ID,
          status: "running",
          processed_rows: 10,
          failed_rows: 0,
          total_rows: null,
        },
        error: null,
      });

      const result = await importJobService.updateImportJobProgress({
        import_job_id: JOB_ID,
        processed_rows: 10,
      });

      expect(result.error).toBeNull();
      expect(supabaseMock.rpc).toHaveBeenCalledWith(
        "update_import_job_progress",
        {
          p_import_job_id: JOB_ID,
          p_processed_rows: 10,
          p_failed_rows: 0,
          p_total_rows: null,
        },
      );
    });

    it("rejects invalid job id and row counts without calling the RPC", async () => {
      const badId = await importJobService.updateImportJobProgress({
        import_job_id: "bad-id",
        processed_rows: 1,
      });
      expect(badId.data).toBeNull();
      expect(badId.error).toBe("Import job id is required.");

      const badFailed = await importJobService.updateImportJobProgress({
        import_job_id: JOB_ID,
        processed_rows: 5,
        failed_rows: 6,
      });
      expect(badFailed.data).toBeNull();
      expect(badFailed.error).toBe(
        "Failed rows cannot exceed processed rows.",
      );

      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("maps already-finished RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Import job is already finished.",
        },
      });

      const result = await importJobService.updateImportJobProgress({
        import_job_id: JOB_ID,
        processed_rows: 1,
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Import job is already finished.");
      expectNoDirectWrites();
    });
  });

  describe("completeImportJob", () => {
    it("completes an import job successfully", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          import_job_id: JOB_ID,
          status: "completed",
        },
        error: null,
      });

      const result = await importJobService.completeImportJob({
        import_job_id: JOB_ID,
        status: "completed",
        processed_rows: 100,
        failed_rows: 0,
        total_rows: 100,
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        importJobId: JOB_ID,
        status: "completed",
      } satisfies CompleteImportJobResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("complete_import_job", {
        p_import_job_id: JOB_ID,
        p_status: "completed",
        p_processed_rows: 100,
        p_failed_rows: 0,
        p_total_rows: 100,
        p_error_summary: null,
      });
      expectNoDirectWrites();
    });

    it("fails an import job successfully", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: {
          import_job_id: JOB_ID,
          status: "failed",
        },
        error: null,
      });

      const result = await importJobService.completeImportJob({
        import_job_id: JOB_ID,
        status: "failed",
        processed_rows: 20,
        failed_rows: 5,
        error_summary: "Invalid CSV header",
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual({
        importJobId: JOB_ID,
        status: "failed",
      } satisfies CompleteImportJobResult);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("complete_import_job", {
        p_import_job_id: JOB_ID,
        p_status: "failed",
        p_processed_rows: 20,
        p_failed_rows: 5,
        p_total_rows: null,
        p_error_summary: "Invalid CSV header",
      });
      expectNoDirectWrites();
    });

    it("rejects failed completion without error summary", async () => {
      const result = await importJobService.completeImportJob({
        import_job_id: JOB_ID,
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
          message: "Import job was not found.",
        },
      });

      const result = await importJobService.completeImportJob({
        import_job_id: JOB_ID,
        status: "completed",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Import job was not found.");
    });
  });

  describe("listImportJobs", () => {
    it("maps import jobs to typed DTOs in RPC order", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: [
          importJobRow({
            id: JOB_ID_2,
            import_type: "customers",
            file_name: "customers.csv",
            status: "completed",
            total_rows: 50,
            processed_rows: 50,
            failed_rows: 0,
            started_at: "2026-07-25T17:00:00.000Z",
            completed_at: "2026-07-25T17:05:00.000Z",
          }),
          importJobRow({
            id: JOB_ID,
            import_type: "ingredients",
            file_name: "ingredients.csv",
            status: "pending",
            total_rows: 100,
            processed_rows: 0,
            failed_rows: 0,
            started_at: null,
            completed_at: null,
          }),
        ],
        error: null,
      });

      const result = await importJobService.listImportJobs();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([
        {
          id: JOB_ID_2,
          importType: "customers",
          fileName: "customers.csv",
          status: "completed",
          totalRows: 50,
          processedRows: 50,
          failedRows: 0,
          startedAt: "2026-07-25T17:00:00.000Z",
          completedAt: "2026-07-25T17:05:00.000Z",
          createdBy: null,
          errorSummary: null,
        },
        {
          id: JOB_ID,
          importType: "ingredients",
          fileName: "ingredients.csv",
          status: "pending",
          totalRows: 100,
          processedRows: 0,
          failedRows: 0,
          startedAt: null,
          completedAt: null,
          createdBy: null,
          errorSummary: null,
        },
      ] satisfies ImportJob[]);
      expect(result.data?.[0]?.startedAt).toBe("2026-07-25T17:00:00.000Z");
      expect(result.data?.[1]?.startedAt).toBeNull();
      expect(supabaseMock.rpc).toHaveBeenCalledWith("list_import_jobs");
      expectNoDirectWrites();
    });

    it("returns an empty array when history is empty", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: [],
        error: null,
      });

      const result = await importJobService.listImportJobs();

      expect(result.error).toBeNull();
      expect(result.data).toEqual([] satisfies ImportJob[]);
      expectNoDirectWrites();
    });

    it("is read-only and never writes tables", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: [importJobRow()],
        error: null,
      });

      await importJobService.listImportJobs();

      expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
        "list_import_jobs",
      ]);
      expectNoDirectWrites();
    });

    it("maps missing list_import_jobs function errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Could not find the function public.list_import_jobs",
        },
      });

      const result = await importJobService.listImportJobs();

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Import job management is not available yet. Apply the import jobs database script and try again.",
      );
    });

    it("rejects invalid list payloads", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: { not: "an-array" },
        error: null,
      });

      const result = await importJobService.listImportJobs();

      expect(result.data).toBeNull();
      expect(result.error).toBe("Import job list response was invalid.");
    });
  });
});
