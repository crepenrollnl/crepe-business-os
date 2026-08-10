/**
 * Hook coverage for useReportingWorkspace.
 *
 * Orchestrates loading only via reportingWorkspaceService.getReportingWorkspace.
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReportingWorkspace } from "../types/reporting-workspace";

const { getReportingWorkspaceMock } = vi.hoisted(() => ({
  getReportingWorkspaceMock: vi.fn(),
}));

vi.mock("../services/reporting-workspace-service", () => ({
  reportingWorkspaceService: {
    getReportingWorkspace: (...args: unknown[]) =>
      getReportingWorkspaceMock(...args),
  },
}));

import { useReportingWorkspace } from "./use-reporting-workspace";

function workspace(
  overrides?: Partial<ReportingWorkspace>,
): ReportingWorkspace {
  return {
    workspace_title: "Reporting Workspace",
    reporting_version: "1.0",
    available_dashboards: [],
    navigation_catalog: [],
    reporting_overview: null,
    generated_at: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useReportingWorkspace", () => {
  beforeEach(() => {
    getReportingWorkspaceMock.mockReset();
  });

  it("loads workspace through getReportingWorkspace and exposes presentation fields", async () => {
    const data = workspace();
    getReportingWorkspaceMock.mockResolvedValue({ data, error: null });

    const { result } = renderHook(() => useReportingWorkspace());

    expect(result.current.loading).toBe(true);

    await flushMicrotasks();

    expect(getReportingWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(getReportingWorkspaceMock).toHaveBeenCalledWith();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.workspace).toEqual(data);
    expect(result.current.title).toBe("Reporting Workspace");
    expect(result.current.reportingVersion).toBe("1.0");
    expect(result.current.generatedAt).toBe("2026-07-25T16:00:00.000Z");
  });

  it("uses presentation defaults when workspace is unavailable", async () => {
    getReportingWorkspaceMock.mockResolvedValue({
      data: null,
      error: "Failed to load reporting workspace",
    });

    const { result } = renderHook(() => useReportingWorkspace());
    await flushMicrotasks();

    expect(result.current.workspace).toBeNull();
    expect(result.current.error).toBe("Failed to load reporting workspace");
    expect(result.current.title).toBe("Reports");
    expect(result.current.reportingVersion).toBe("-");
    expect(result.current.generatedAt).toBeNull();
  });

  it("retry reloads through the same service method", async () => {
    getReportingWorkspaceMock
      .mockResolvedValueOnce({
        data: null,
        error: "Temporary failure",
      })
      .mockResolvedValueOnce({
        data: workspace({ workspace_title: "Recovered Workspace" }),
        error: null,
      });

    const { result } = renderHook(() => useReportingWorkspace());
    await flushMicrotasks();

    expect(result.current.error).toBe("Temporary failure");

    await act(async () => {
      await result.current.retry();
    });

    expect(getReportingWorkspaceMock).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.title).toBe("Recovered Workspace");
  });
});
