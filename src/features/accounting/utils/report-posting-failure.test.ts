import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock, captureMessageMock, captureExceptionMock } = vi.hoisted(
  () => ({
    supabaseMock: {
      rpc: vi.fn(),
    },
    captureMessageMock: vi.fn(),
    captureExceptionMock: vi.fn(),
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import { reportPostingFailure } from "./report-posting-failure";

const INPUT = {
  sourceFlow: "sale_confirm" as const,
  entityType: "sale",
  entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  businessEventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  errorMessage: "Sale confirmed but accounting posting failed.",
};

describe("reportPostingFailure", () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
    captureMessageMock.mockReset();
    captureExceptionMock.mockReset();
    supabaseMock.rpc.mockResolvedValue({ data: "row-id", error: null });
  });

  it("calls record_posting_failure and Sentry.captureMessage, and does not throw", async () => {
    await expect(reportPostingFailure(INPUT)).resolves.toBeUndefined();

    expect(supabaseMock.rpc).toHaveBeenCalledWith("record_posting_failure", {
      p_source_flow: "sale_confirm",
      p_entity_type: "sale",
      p_entity_id: INPUT.entityId,
      p_business_event_id: INPUT.businessEventId,
      p_error_message: INPUT.errorMessage,
    });
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Accounting posting failed: Sale confirmed but accounting posting failed.",
      expect.objectContaining({
        level: "error",
        tags: {
          source_flow: "sale_confirm",
          entity_type: "sale",
          entity_id: INPUT.entityId,
        },
      }),
    );
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("still captures the posting failure to Sentry when the RPC itself fails", async () => {
    const rpcError = { message: "function record_posting_failure does not exist" };
    supabaseMock.rpc.mockResolvedValue({ data: null, error: rpcError });

    await expect(reportPostingFailure(INPUT)).resolves.toBeUndefined();

    expect(captureMessageMock).toHaveBeenCalledTimes(1);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      rpcError,
      expect.objectContaining({
        extra: expect.objectContaining({
          stage: "record_posting_failure_rpc",
        }),
      }),
    );
  });

  it("captures a thrown RPC failure to Sentry and still does not throw", async () => {
    supabaseMock.rpc.mockRejectedValue(new Error("network down"));

    await expect(reportPostingFailure(INPUT)).resolves.toBeUndefined();

    expect(captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        extra: expect.objectContaining({
          stage: "record_posting_failure_rpc",
        }),
      }),
    );
  });

  it("swallows a Sentry captureMessage throw so the caller is unaffected", async () => {
    captureMessageMock.mockImplementation(() => {
      throw new Error("sentry ingest blocked");
    });

    await expect(reportPostingFailure(INPUT)).resolves.toBeUndefined();
    expect(supabaseMock.rpc).toHaveBeenCalled();
  });
});
