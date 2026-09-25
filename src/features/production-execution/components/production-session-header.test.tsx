import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ProductionSessionWithRelations } from "../types/production-session";
import {
  clearMatchMediaStub,
  stubMatchMedia,
} from "../hooks/stub-match-media";
import {
  ProductionSessionHeader,
  SESSION_HEADER_ACTIONS_TEST_ID,
  SESSION_STICKY_ACTIONS_TEST_ID,
} from "./production-session-header";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const session: ProductionSessionWithRelations = {
  id: "session-1",
  session_number: 4,
  production_plan_id: "plan-1",
  status: "in_progress",
  started_at: "2026-08-03T08:00:00.000Z",
  completed_at: null,
  completed_by: null,
  operator_name: null,
  notes: null,
  created_at: "2026-08-03T08:00:00.000Z",
  lines: [],
  plan: { id: "plan-1", plan_number: 1, name: "Saturday prep" },
};

const idleProps = {
  session,
  notes: "",
  canEdit: true,
  finishing: false,
  saving: false,
  actionError: null as string | null,
  onNotesChange: vi.fn(),
  onSaveProgress: vi.fn(),
  onFinish: vi.fn(),
};

describe("ProductionSessionHeader finish blocked reason", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    clearMatchMediaStub();
  });

  it("shows the actual disabled reason next to Finish instead of a title tooltip", () => {
    render(
      <ProductionSessionHeader
        {...idleProps}
        canFinish={false}
        finishBlockedReason="Fix the invalid Recipe Batches Used value for Chicken Crepe."
      />,
    );

    const finish = screen.getByRole("button", { name: "Finish Production" });
    expect(finish).toBeDisabled();
    expect(finish).not.toHaveAttribute("title");
    expect(
      screen.getByText(
        "Fix the invalid Recipe Batches Used value for Chicken Crepe.",
      ),
    ).toBeVisible();
  });

  it("hides the blocked reason when Finish is available", () => {
    render(
      <ProductionSessionHeader
        {...idleProps}
        canFinish
        finishBlockedReason={null}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Finish Production" }),
    ).toBeEnabled();
    expect(
      screen.queryByText(/Fix the invalid|Enter an actual produced quantity/),
    ).not.toBeInTheDocument();
  });

  it("keeps Save/Finish in the header on desktop", () => {
    render(
      <ProductionSessionHeader
        {...idleProps}
        canFinish
        finishBlockedReason={null}
      />,
    );

    expect(screen.getByTestId(SESSION_HEADER_ACTIONS_TEST_ID)).toBeInTheDocument();
    expect(
      screen.queryByTestId(SESSION_STICKY_ACTIONS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  it("moves Save/Finish to a sticky bar below lg", async () => {
    stubMatchMedia(false);
    render(
      <ProductionSessionHeader
        {...idleProps}
        canFinish
        finishBlockedReason={null}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId(SESSION_STICKY_ACTIONS_TEST_ID),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId(SESSION_HEADER_ACTIONS_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId(SESSION_STICKY_ACTIONS_TEST_ID)).toHaveClass(
      "fixed",
    );
    expect(screen.getByTestId(SESSION_STICKY_ACTIONS_TEST_ID).className)
      .toMatchInlineSnapshot(
        `"fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(24,24,27,0.08)] backdrop-blur"`,
      );
  });

  it("does not render sticky actions when the session is not editable", () => {
    render(
      <ProductionSessionHeader
        {...idleProps}
        canEdit={false}
        canFinish={false}
        finishBlockedReason={null}
      />,
    );

    expect(
      screen.queryByTestId(SESSION_STICKY_ACTIONS_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Finish Production" }),
    ).not.toBeInTheDocument();
  });
});
