/**
 * Service-level coverage for globalSearchService (DEV-046).
 *
 * Searches must go only through global_search with SQL ILIKE.
 * The service must not filter results in TypeScript, call RPCs, or mutate data.
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

import { globalSearchService } from "./global-search-service";
import type { SearchResult } from "../types/search";

const ENTITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ENTITY_ID_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

const SEARCH_SELECT =
  "entity_type, entity_id, code, title, subtitle, status";

function searchRow(overrides?: Record<string, unknown>) {
  return {
    entity_type: "ingredient",
    entity_id: ENTITY_ID,
    code: null,
    title: "Flour",
    subtitle: "kg",
    status: "ok",
    ...overrides,
  };
}

function forbidOtherTables(table: string) {
  if (table !== "global_search") {
    throw new Error(`Unexpected table: ${table}`);
  }
}

function mockSearchView(
  rows: Record<string, unknown>[],
  error: unknown = null,
) {
  const limitMock = vi.fn().mockResolvedValue({
    data: error ? null : rows,
    error,
  });
  const orderThird = vi.fn().mockReturnValue({
    limit: limitMock,
  });
  const orderSecond = vi.fn().mockReturnValue({
    order: orderThird,
  });
  const orderFirst = vi.fn().mockReturnValue({
    order: orderSecond,
  });
  const ilikeMock = vi.fn().mockReturnValue({
    order: orderFirst,
  });
  const selectMock = vi.fn().mockReturnValue({
    ilike: ilikeMock,
  });

  supabaseMock.from.mockImplementation((table: string) => {
    forbidOtherTables(table);

    return {
      select: selectMock,
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    };
  });

  return {
    selectMock,
    ilikeMock,
    orderFirst,
    orderSecond,
    orderThird,
    limitMock,
  };
}

function expectReadOnly() {
  const tablesTouched = supabaseMock.from.mock.calls.map(
    (call) => call[0] as string,
  );
  expect(tablesTouched).toEqual(["global_search"]);
  expect(tablesTouched).not.toContain("ingredients");
  expect(tablesTouched).not.toContain("recipes");
  expect(tablesTouched).not.toContain("customers");
  expect(tablesTouched).not.toContain("suppliers");
  expect(tablesTouched).not.toContain("sales");
  expect(tablesTouched).not.toContain("purchases");
  expect(supabaseMock.rpc).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

describe("globalSearchService.search (DEV-046)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
  });

  it("queries only global_search with ILIKE and returns typed results", async () => {
    const {
      selectMock,
      ilikeMock,
      orderFirst,
      orderSecond,
      orderThird,
      limitMock,
    } = mockSearchView([
      searchRow(),
      searchRow({
        entity_type: "customer",
        entity_id: ENTITY_ID_2,
        code: "C-000001",
        title: "Crepe Catering",
        subtitle: "hello@crepe.test",
        status: "active",
      }),
    ]);

    const result = await globalSearchService.search("crepe");

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        entityType: "ingredient",
        entityId: ENTITY_ID,
        code: null,
        title: "Flour",
        subtitle: "kg",
        status: "ok",
      },
      {
        entityType: "customer",
        entityId: ENTITY_ID_2,
        code: "C-000001",
        title: "Crepe Catering",
        subtitle: "hello@crepe.test",
        status: "active",
      },
    ] satisfies SearchResult[]);
    expect(supabaseMock.from).toHaveBeenCalledWith("global_search");
    expect(selectMock).toHaveBeenCalledWith(SEARCH_SELECT);
    expect(ilikeMock).toHaveBeenCalledWith("search_text", "%crepe%");
    expect(orderFirst).toHaveBeenCalledWith("entity_type", {
      ascending: true,
    });
    expect(orderSecond).toHaveBeenCalledWith("title", { ascending: true });
    expect(orderThird).toHaveBeenCalledWith("entity_id", { ascending: true });
    expect(limitMock).toHaveBeenCalledWith(20);
    expectReadOnly();
  });

  it("returns an empty array when the view has no matches", async () => {
    mockSearchView([]);

    const result = await globalSearchService.search("zzz-no-match");

    expect(result.error).toBeNull();
    expect(result.data).toEqual([]);
    expectReadOnly();
  });

  it("applies the default limit of 20 when limit is omitted", async () => {
    const { limitMock, ilikeMock } = mockSearchView([searchRow()]);

    await globalSearchService.search("flour");

    expect(ilikeMock).toHaveBeenCalledWith("search_text", "%flour%");
    expect(limitMock).toHaveBeenCalledWith(20);
  });

  it("applies a custom limit", async () => {
    const { limitMock } = mockSearchView([searchRow()]);

    const result = await globalSearchService.search("flour", 5);

    expect(result.error).toBeNull();
    expect(limitMock).toHaveBeenCalledWith(5);
  });

  it("rejects blank query without querying", async () => {
    const result = await globalSearchService.search("   ");

    expect(result.data).toBeNull();
    expect(result.error).toBe("Search query is required.");
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid and oversized limits without querying", async () => {
    const invalidLimit = await globalSearchService.search("flour", 0);
    expect(invalidLimit.data).toBeNull();
    expect(invalidLimit.error).toBe("Search limit must be a positive integer.");

    const oversized = await globalSearchService.search("flour", 101);
    expect(oversized.data).toBeNull();
    expect(oversized.error).toBe("Search limit must be 100 or fewer.");

    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it("escapes ILIKE wildcards in the query pattern", async () => {
    const { ilikeMock } = mockSearchView([]);

    await globalSearchService.search("100%_off");

    expect(ilikeMock).toHaveBeenCalledWith("search_text", "%100\\%\\_off%");
  });

  it("maps missing-view errors", async () => {
    mockSearchView([], {
      message: 'relation "global_search" does not exist',
      code: "42P01",
    });

    const result = await globalSearchService.search("flour");

    expect(result.data).toBeNull();
    expect(result.error).toBe(
      "Global search is not available yet. Apply the global search database script and try again.",
    );
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });

  it("does not filter or recalculate results in TypeScript", async () => {
    // View returns a row that would not match "flour" if TS filtered by title.
    mockSearchView([
      searchRow({
        title: "Sugar",
        subtitle: "bag",
        status: "ok",
      }),
    ]);

    const result = await globalSearchService.search("flour");

    expect(result.error).toBeNull();
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0]?.title).toBe("Sugar");
    expectReadOnly();
  });

  it("never mutates data", async () => {
    mockSearchView([searchRow()]);

    await globalSearchService.search("flour", 10);

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expectReadOnly();
  });
});
