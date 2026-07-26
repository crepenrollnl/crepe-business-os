/**
 * UI coverage for GlobalSearch (DEV-047).
 *
 * Renders SearchResult fields as returned; navigates via getSearchResultHref.
 * Only globalSearchService.search is used — no from/rpc on select.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SearchResult } from "../types/search";

const { pushMock, searchMock, fromMock, rpcMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  searchMock: vi.fn(),
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
  },
}));

vi.mock("../services/global-search-service", () => ({
  globalSearchService: {
    search: (...args: unknown[]) => searchMock(...args),
  },
}));

import { GlobalSearch } from "./global-search";

const SAMPLE_RESULT: SearchResult = {
  entityType: "ingredient",
  entityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  code: "ING-001",
  title: "Flour",
  subtitle: "Raw material · kg",
  status: "In Stock",
};

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("GlobalSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pushMock.mockReset();
    searchMock.mockReset();
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function renderAndType(value: string) {
    const view = render(<GlobalSearch />);
    const input = within(view.container).getByRole("searchbox", {
      name: /global search/i,
    });

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });

    return { input, view };
  }

  it("does not search for 1 character and shows min-length guidance", () => {
    renderAndType("a");

    expect(searchMock).not.toHaveBeenCalled();
    expect(
      screen.getByText(/type at least 2 characters to search/i),
    ).toBeInTheDocument();
  });

  it("loads then renders result fields after 2+ chars and 300ms", async () => {
    searchMock.mockResolvedValue({ data: [SAMPLE_RESULT], error: null });

    renderAndType("fl");

    expect(searchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/searching/i);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flushMicrotasks();

    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(searchMock).toHaveBeenCalledWith("fl");

    const listbox = screen.getByRole("listbox", { name: /search results/i });
    expect(within(listbox).getByText("Flour")).toBeInTheDocument();
    expect(within(listbox).getByText("Raw material · kg")).toBeInTheDocument();
    expect(within(listbox).getByText("ING-001")).toBeInTheDocument();
    expect(within(listbox).getByText("In Stock")).toBeInTheDocument();
    expect(within(listbox).getByText("Ingredient")).toBeInTheDocument();
  });

  it("shows empty state when search returns no matches", async () => {
    searchMock.mockResolvedValue({ data: [], error: null });

    renderAndType("zz");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flushMicrotasks();

    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(screen.getByText(/nothing matched/i)).toBeInTheDocument();
  });

  it("shows error state when the service fails", async () => {
    searchMock.mockResolvedValue({
      data: null,
      error: "Failed to search",
    });

    renderAndType("fl");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flushMicrotasks();

    expect(screen.getByRole("alert")).toHaveTextContent("Failed to search");
  });

  it("navigates on result click, clears input, and closes dropdown", async () => {
    searchMock.mockResolvedValue({ data: [SAMPLE_RESULT], error: null });

    const { input } = renderAndType("fl");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flushMicrotasks();

    expect(screen.getByRole("option")).toBeInTheDocument();

    const searchCallsBeforeSelect = searchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("option"));

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(
      `/inventory?id=${encodeURIComponent(SAMPLE_RESULT.entityId)}`,
    );
    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(searchMock).toHaveBeenCalledTimes(searchCallsBeforeSelect);
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("navigates on Enter when a result option is focused", async () => {
    searchMock.mockResolvedValue({ data: [SAMPLE_RESULT], error: null });

    const { input } = renderAndType("fl");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flushMicrotasks();

    const option = screen.getByRole("option");
    expect(option).toBeInTheDocument();

    const searchCallsBeforeSelect = searchMock.mock.calls.length;
    option.focus();
    fireEvent.keyDown(option, { key: "Enter", code: "Enter" });

    expect(pushMock).toHaveBeenCalledTimes(1);
    expect(pushMock).toHaveBeenCalledWith(
      `/inventory?id=${encodeURIComponent(SAMPLE_RESULT.entityId)}`,
    );
    expect(input).toHaveValue("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(searchMock).toHaveBeenCalledTimes(searchCallsBeforeSelect);
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("uses search() as the only service call", async () => {
    searchMock.mockResolvedValue({ data: [SAMPLE_RESULT], error: null });

    renderAndType("fl");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await flushMicrotasks();

    expect(searchMock).toHaveBeenCalledTimes(1);
    expect(fromMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
