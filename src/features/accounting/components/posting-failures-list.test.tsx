"use client";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { PostingFailuresList } from "./posting-failures-list";
import type { PostingFailure } from "../types/posting-failure";

const FAILURE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function failure(overrides?: Partial<PostingFailure>): PostingFailure {
  return {
    id: FAILURE_ID,
    occurredAt: "2026-09-18T12:00:00.000Z",
    sourceFlow: "sale_confirm",
    entityType: "sale",
    entityId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    businessEventId: null,
    errorMessage: "Sale confirmed but accounting posting failed.",
    resolvedAt: null,
    resolvedBy: null,
    resolutionNote: null,
    ...overrides,
  };
}

function renderList(
  overrides?: Partial<React.ComponentProps<typeof PostingFailuresList>>,
) {
  const props: React.ComponentProps<typeof PostingFailuresList> = {
    items: [failure()],
    loading: false,
    error: null,
    resolvingId: null,
    repostingId: null,
    actionError: null,
    rowErrors: {},
    notice: null,
    onRetry: () => undefined,
    onResolve: vi.fn().mockResolvedValue(true),
    onRepost: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  render(<PostingFailuresList {...props} />);
  return props;
}

describe("PostingFailuresList", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders unresolved rows and calls onResolve with the note", async () => {
    const user = userEvent.setup();
    const props = renderList();

    expect(
      screen.getByText("Sale confirmed but accounting posting failed."),
    ).toBeInTheDocument();
    expect(screen.getByText("Sale confirm")).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/resolution note/i),
      "Posted by hand",
    );
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));

    expect(props.onResolve).toHaveBeenCalledWith(FAILURE_ID, "Posted by hand");
  });

  it("shows the empty state when there are no unresolved rows", () => {
    renderList({ items: [] });

    expect(
      screen.getByText("No unresolved posting failures"),
    ).toBeInTheDocument();
  });

  it("calls onRepost when Post again is pressed", async () => {
    const user = userEvent.setup();
    const props = renderList();

    await user.click(screen.getByRole("button", { name: "Post again" }));

    expect(props.onRepost).toHaveBeenCalledWith(FAILURE_ID);
    expect(props.onResolve).not.toHaveBeenCalled();
  });

  it("disables both buttons and the note while Post again runs on that row", () => {
    renderList({ repostingId: FAILURE_ID });

    expect(screen.getByRole("button", { name: "Posting…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mark resolved" })).toBeDisabled();
    expect(screen.getByLabelText(/resolution note/i)).toBeDisabled();
  });

  it("disables both buttons while Mark resolved runs on that row", () => {
    renderList({ resolvingId: FAILURE_ID });

    expect(screen.getByRole("button", { name: "Post again" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("keeps other rows clickable while one row is busy", () => {
    const other = failure({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      errorMessage: "Another failure",
    });
    renderList({ items: [failure(), other], repostingId: FAILURE_ID });

    const postButtons = screen.getAllByRole("button", { name: /Post again|Posting…/ });
    expect(postButtons[0]).toBeDisabled();
    expect(postButtons[1]).toBeEnabled();
  });

  it("shows a Post again error on its row and keeps the row", () => {
    renderList({
      rowErrors: {
        [FAILURE_ID]: "Posting again failed: No open fiscal period covers 2026-09-01.",
      },
    });

    expect(
      screen.getByTestId(`posting-failure-row-error-${FAILURE_ID}`),
    ).toHaveTextContent(
      "Posting again failed: No open fiscal period covers 2026-09-01.",
    );
    expect(
      screen.getByText("Sale confirmed but accounting posting failed."),
    ).toBeInTheDocument();
  });

  it("shows the success note", () => {
    renderList({ items: [], notice: "Posted" });

    expect(screen.getByRole("status")).toHaveTextContent("Posted");
  });
});
