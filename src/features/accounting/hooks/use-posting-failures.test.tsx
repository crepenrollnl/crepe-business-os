/**
 * usePostingFailures: owner/partner gate (same rule as the sidebar) and the
 * "Post again" action (repost_posting_failure, sql/154).
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostingFailure } from "../types/posting-failure";

const { listUnresolvedMock, resolveMock, repostMock, useRoleMock } =
  vi.hoisted(() => ({
    listUnresolvedMock: vi.fn(),
    resolveMock: vi.fn(),
    repostMock: vi.fn(),
    useRoleMock: vi.fn(),
  }));

vi.mock("../services/posting-failures-service", () => ({
  postingFailuresService: {
    listUnresolved: (...args: unknown[]) => listUnresolvedMock(...args),
    resolve: (...args: unknown[]) => resolveMock(...args),
    repost: (...args: unknown[]) => repostMock(...args),
  },
}));

vi.mock("@/hooks/use-role", () => ({
  useRole: () => useRoleMock(),
}));

function asRole(role: string | null) {
  useRoleMock.mockReturnValue({ role, loading: false, reload: () => undefined });
}

import { usePostingFailures } from "./use-posting-failures";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function failure(id: string): PostingFailure {
  return {
    id,
    occurredAt: "2026-09-18T12:00:00.000Z",
    sourceFlow: "write_off_record",
    entityType: "write_off",
    entityId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    businessEventId: null,
    errorMessage: "Automatic posting failed: No open fiscal period.",
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
  };
}

async function renderLoaded() {
  const hook = renderHook(() => usePostingFailures());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe("usePostingFailures access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listUnresolvedMock.mockResolvedValue({ data: [failure(A)], error: null });
  });

  it.each(["owner", "partner"])("loads the list for %s", async (role) => {
    asRole(role);

    const { result } = await renderLoaded();

    expect(result.current.access).toBe("allowed");
    expect(result.current.items).toHaveLength(1);
  });

  it.each(["seller", null])(
    "denies %s without querying posting_failures",
    async (role) => {
      asRole(role);

      const { result } = await renderLoaded();

      expect(result.current.access).toBe("denied");
      expect(result.current.items).toEqual([]);
      expect(listUnresolvedMock).not.toHaveBeenCalled();
    },
  );
});

describe("usePostingFailures.repost (sql/154)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    asRole("owner");
  });

  it("reloads the list after a successful Post again (several rows may close)", async () => {
    listUnresolvedMock
      .mockResolvedValueOnce({ data: [failure(A), failure(B)], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    repostMock.mockResolvedValue({
      data: { status: "posted", resolved: 2 },
      error: null,
    });

    const { result } = await renderLoaded();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.repost(A);
    });

    expect(ok).toBe(true);
    expect(repostMock).toHaveBeenCalledWith(A);
    expect(listUnresolvedMock).toHaveBeenCalledTimes(2);
    expect(result.current.items).toEqual([]);
    expect(result.current.notice).toBe("Posted");
    expect(result.current.repostingId).toBeNull();
  });

  it("says nothing to post when the database closed the row without a journal", async () => {
    listUnresolvedMock
      .mockResolvedValueOnce({ data: [failure(A)], error: null })
      .mockResolvedValueOnce({ data: [], error: null });
    repostMock.mockResolvedValue({
      data: { status: "nothing_to_post", resolved: 1 },
      error: null,
    });

    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.repost(A);
    });

    expect(result.current.notice).toBe("Nothing to post — closed");
  });

  it("keeps the row and shows the error on it when Post again fails", async () => {
    listUnresolvedMock.mockResolvedValue({ data: [failure(A)], error: null });
    repostMock.mockResolvedValue({
      data: null,
      error: "Posting again failed: No open fiscal period covers 2026-09-01.",
    });

    const { result } = await renderLoaded();

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.repost(A);
    });

    expect(ok).toBe(false);
    expect(result.current.items.map((item) => item.id)).toEqual([A]);
    expect(result.current.rowErrors[A]).toBe(
      "Posting again failed: No open fiscal period covers 2026-09-01.",
    );
    expect(result.current.notice).toBeNull();
    expect(listUnresolvedMock).toHaveBeenCalledTimes(1);
    expect(result.current.repostingId).toBeNull();
  });

  it("marks the row busy while Post again runs", async () => {
    listUnresolvedMock.mockResolvedValue({ data: [failure(A)], error: null });
    let finish: (value: unknown) => void = () => undefined;
    repostMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );

    const { result } = await renderLoaded();

    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = result.current.repost(A);
    });

    await waitFor(() => expect(result.current.repostingId).toBe(A));

    listUnresolvedMock.mockResolvedValue({ data: [], error: null });
    await act(async () => {
      finish({ data: { status: "posted", resolved: 1 }, error: null });
      await pending;
    });

    expect(result.current.repostingId).toBeNull();
  });

  it("clears an old row error when Post again is pressed again", async () => {
    listUnresolvedMock.mockResolvedValue({ data: [failure(A)], error: null });
    repostMock
      .mockResolvedValueOnce({ data: null, error: "Posting again failed: x." })
      .mockResolvedValueOnce({ data: { status: "posted", resolved: 1 }, error: null });

    const { result } = await renderLoaded();

    await act(async () => {
      await result.current.repost(A);
    });
    expect(result.current.rowErrors[A]).toBe("Posting again failed: x.");

    listUnresolvedMock.mockResolvedValue({ data: [], error: null });
    await act(async () => {
      await result.current.repost(A);
    });

    expect(result.current.rowErrors[A]).toBeUndefined();
  });
});
