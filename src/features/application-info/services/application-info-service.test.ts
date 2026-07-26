/**
 * Service-level coverage for applicationInfoService (DEV-056).
 *
 * Reads must go only through get_application_info RPC.
 * The service must not query tables directly, recalculate values, cache,
 * or write data.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { applicationInfoService } from "./application-info-service";
import type { ApplicationInfo } from "../types/application-info";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function infoRow(overrides?: Record<string, unknown>) {
  return {
    application_name: "Crepe'n Roll OS",
    application_version: "0.1.0",
    database_version: "15.8",
    build_number: "1",
    environment: "unknown",
    timezone: "Europe/Amsterdam",
    generated_at: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

function mappedInfo(overrides?: Partial<ApplicationInfo>): ApplicationInfo {
  return {
    applicationName: "Crepe'n Roll OS",
    applicationVersion: "0.1.0",
    databaseVersion: "15.8",
    buildNumber: "1",
    environment: "unknown",
    timezone: "Europe/Amsterdam",
    generatedAt: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

function expectNoDirectWrites() {
  expect(supabaseMock.from).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

function expectReadOnly() {
  expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
    "get_application_info",
  ]);
  expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
  expectNoDirectWrites();
}

describe("applicationInfoService.getApplicationInfo (DEV-056)", () => {
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

  it("retrieves application information successfully via get_application_info", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: infoRow(),
      error: null,
    });

    const result = await applicationInfoService.getApplicationInfo();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(mappedInfo() satisfies ApplicationInfo);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith("get_application_info");
    expectReadOnly();
  });

  it("maps RPC payload to typed ApplicationInfo DTO", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: infoRow({
        application_name: "Crepe'n Roll OS",
        application_version: "1.2.3",
        database_version: "16.1",
        build_number: "42",
        environment: "production",
        timezone: "UTC",
        generated_at: "2026-07-25T18:30:00.000Z",
      }),
      error: null,
    });

    const result = await applicationInfoService.getApplicationInfo();

    expect(result.error).toBeNull();
    expect(result.data).toEqual(
      mappedInfo({
        applicationName: "Crepe'n Roll OS",
        applicationVersion: "1.2.3",
        databaseVersion: "16.1",
        buildNumber: "42",
        environment: "production",
        timezone: "UTC",
        generatedAt: "2026-07-25T18:30:00.000Z",
      }) satisfies ApplicationInfo,
    );
    expectReadOnly();
  });

  it("maps environment values without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: infoRow({ environment: "staging" }),
      error: null,
    });

    const result = await applicationInfoService.getApplicationInfo();

    expect(result.error).toBeNull();
    expect(result.data?.environment).toBe("staging");
    expectReadOnly();
  });

  it("maps application version and build number without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: infoRow({
        application_version: "2.0.0",
        build_number: "99",
        database_version: "15.8 (Ubuntu 15.8-1)",
      }),
      error: null,
    });

    const result = await applicationInfoService.getApplicationInfo();

    expect(result.error).toBeNull();
    expect(result.data?.applicationVersion).toBe("2.0.0");
    expect(result.data?.buildNumber).toBe("99");
    expect(result.data?.databaseVersion).toBe("15.8 (Ubuntu 15.8-1)");
    expectReadOnly();
  });

  it("maps timezone from RPC without recalculation", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: infoRow({ timezone: "America/New_York" }),
      error: null,
    });

    const result = await applicationInfoService.getApplicationInfo();

    expect(result.error).toBeNull();
    expect(result.data?.timezone).toBe("America/New_York");
    expectReadOnly();
  });

  it("maps missing get_application_info function errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: "Could not find the function public.get_application_info",
      },
    });

    const result = await applicationInfoService.getApplicationInfo();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Application information is not available yet. Apply the application information database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("maps missing application_info relation errors", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'relation "application_info" does not exist',
        code: "42P01",
      },
    });

    const result = await applicationInfoService.getApplicationInfo();

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Application information is not available yet. Apply the application information database script and try again.",
    );
    expectNoDirectWrites();
  });

  it("rejects invalid RPC payloads", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: [],
      error: null,
    });

    const result = await applicationInfoService.getApplicationInfo();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Application information response was invalid.");
    expectNoDirectWrites();
  });

  it("rejects blank application name", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: infoRow({ application_name: "   " }),
      error: null,
    });

    const result = await applicationInfoService.getApplicationInfo();

    expect(result.data).toBeNull();
    expect(result.error).toBe("Application information response was invalid.");
    expectNoDirectWrites();
  });

  it("rejects blank environment, version, build, and timezone fields", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: infoRow({ environment: "" }),
      error: null,
    });
    const blankEnvironment = await applicationInfoService.getApplicationInfo();
    expect(blankEnvironment.data).toBeNull();
    expect(blankEnvironment.error).toBe(
      "Application information response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: infoRow({ application_version: "" }),
      error: null,
    });
    const blankVersion = await applicationInfoService.getApplicationInfo();
    expect(blankVersion.data).toBeNull();
    expect(blankVersion.error).toBe(
      "Application information response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: infoRow({ build_number: "" }),
      error: null,
    });
    const blankBuild = await applicationInfoService.getApplicationInfo();
    expect(blankBuild.data).toBeNull();
    expect(blankBuild.error).toBe(
      "Application information response was invalid.",
    );

    supabaseMock.rpc.mockResolvedValue({
      data: infoRow({ timezone: "" }),
      error: null,
    });
    const blankTimezone = await applicationInfoService.getApplicationInfo();
    expect(blankTimezone.data).toBeNull();
    expect(blankTimezone.error).toBe(
      "Application information response was invalid.",
    );

    expectNoDirectWrites();
  });

  it("is read-only and never writes tables", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: infoRow(),
      error: null,
    });

    await applicationInfoService.getApplicationInfo();

    expectReadOnly();
  });

  it("never queries application_info or company_settings tables directly", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: infoRow(),
      error: null,
    });

    await applicationInfoService.getApplicationInfo();

    expect(supabaseMock.from).not.toHaveBeenCalledWith("application_info");
    expect(supabaseMock.from).not.toHaveBeenCalledWith("company_settings");
    expectNoDirectWrites();
  });
});
