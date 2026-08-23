import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ProductionExecutionPreviousRunsSection } from "./production-execution-previous-runs-section";
import type { ProductionPlanSessionHistoryItem } from "../types/production-session";

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

function session(
  overrides?: Partial<ProductionPlanSessionHistoryItem>,
): ProductionPlanSessionHistoryItem {
  return {
    id: "session-1",
    session_number: 1,
    status: "completed",
    started_at: "2026-08-22T08:00:00.000Z",
    completed_at: "2026-08-22T10:00:00.000Z",
    lines: [
      {
        recipe_id: "recipe-chicken",
        product_name: "Roasted chicken",
        yield_unit: "kg",
        produced_quantity: 7,
        sort_order: 0,
      },
    ],
    ...overrides,
  };
}

describe("ProductionExecutionPreviousRunsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an empty state when the plan has no sessions", () => {
    render(<ProductionExecutionPreviousRunsSection sessions={[]} />);

    expect(screen.getByText("Previous runs")).toBeInTheDocument();
    expect(screen.getByText("No previous runs")).toBeInTheDocument();
  });

  it("links to the session with produced quantity in the label", () => {
    render(
      <ProductionExecutionPreviousRunsSection sessions={[session()]} />,
    );

    const link = screen.getByRole("link", {
      name: "Session #1 · Completed · 7 kg Roasted chicken",
    });
    expect(link).toHaveAttribute(
      "href",
      "/production-execution/sessions/session-1",
    );
    expect(
      screen.getAllByText("7 kg Roasted chicken").length,
    ).toBeGreaterThan(0);
  });
});
