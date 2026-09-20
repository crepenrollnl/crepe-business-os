"use client";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { PostingFailuresList } from "./posting-failures-list";
import type { PostingFailure } from "../types/posting-failure";

function failure(overrides?: Partial<PostingFailure>): PostingFailure {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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

describe("PostingFailuresList", () => {
  it("renders unresolved rows and calls onResolve with the note", async () => {
    const user = userEvent.setup();
    const onResolve = vi.fn().mockResolvedValue(true);

    render(
      <PostingFailuresList
        items={[failure()]}
        loading={false}
        error={null}
        resolvingId={null}
        actionError={null}
        onRetry={() => undefined}
        onResolve={onResolve}
      />,
    );

    expect(
      screen.getByText("Sale confirmed but accounting posting failed."),
    ).toBeInTheDocument();
    expect(screen.getByText("Sale confirm")).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/resolution note/i),
      "Posted by hand",
    );
    await user.click(screen.getByRole("button", { name: "Mark resolved" }));

    expect(onResolve).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "Posted by hand",
    );
  });

  it("shows the empty state when there are no unresolved rows", () => {
    render(
      <PostingFailuresList
        items={[]}
        loading={false}
        error={null}
        resolvingId={null}
        actionError={null}
        onRetry={() => undefined}
        onResolve={async () => true}
      />,
    );

    expect(
      screen.getByText("No unresolved posting failures"),
    ).toBeInTheDocument();
  });
});
