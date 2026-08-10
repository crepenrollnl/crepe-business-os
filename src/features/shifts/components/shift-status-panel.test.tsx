/**
 * Shift Details / Close Day review UI (DEV-116).
 *
 * Display-only for the stored cash reconciliation.
 * Missing summaries show informational states — never recalculated in the UI.
 *
 * Extended for the Dashboard redesign (Plan_Deystviy_V1.txt, Block 1):
 * the Daily Sales Summary / Daily Profit Summary grids moved to the new
 * "Money Today" block (dashboard-money-today-section.tsx) — this component
 * now only reviews shift status, timing, and cash reconciliation. The
 * previously-documented status-label bug is now fixed: a shift that was
 * actually closed and "no shift has ever existed" render distinct labels
 * ("CLOSED" vs "NEVER OPENED") — see the dedicated test below.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { CashReconciliation } from "../types/cash-reconciliation";
import type { Shift } from "../types/shift";
import { ShiftStatusPanel } from "./shift-status-panel";

const SHIFT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function openShift(overrides?: Partial<Shift>): Shift {
  return {
    id: SHIFT_ID,
    opened_at: "2026-07-26T08:00:00.000Z",
    closed_at: null,
    status: "open",
    notes: null,
    created_at: "2026-07-26T08:00:00.000Z",
    ...overrides,
  };
}

function closedShift(overrides?: Partial<Shift>): Shift {
  return {
    id: SHIFT_ID,
    opened_at: "2026-07-26T08:00:00.000Z",
    closed_at: "2026-07-26T18:00:00.000Z",
    status: "closed",
    notes: null,
    created_at: "2026-07-26T08:00:00.000Z",
    ...overrides,
  };
}

function cashReconciliation(
  overrides?: Partial<CashReconciliation>,
): CashReconciliation {
  return {
    id: "cash-1",
    shift_id: SHIFT_ID,
    expected_cash: 200,
    counted_cash: 200,
    difference: 0,
    notes: null,
    reconciled_at: "2026-07-26T18:05:00.000Z",
    created_at: "2026-07-26T18:05:00.000Z",
    ...overrides,
  };
}

const noop = () => undefined;

describe("ShiftStatusPanel Close Day Review (DEV-116)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an active Shift without close-day review", () => {
    render(
      <ShiftStatusPanel
        activeShift={openShift()}
        closedShift={null}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByTestId("shift-status-label")).toHaveTextContent("OPEN");
    expect(screen.getByTestId("shift-opened-at")).toBeInTheDocument();
    expect(screen.getByTestId("shift-closed-at")).toHaveTextContent("—");
    expect(screen.getByTestId("active-shift-review-note")).toHaveTextContent(
      /close the shift/i,
    );
    expect(
      screen.queryByTestId("shift-close-day-review"),
    ).not.toBeInTheDocument();
  });

  it("renders a closed Shift with opened and closed timestamps", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={closedShift()}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByTestId("shift-status-label")).toHaveTextContent(
      "CLOSED",
    );
    expect(screen.getByTestId("shift-opened-at")).toBeInTheDocument();
    expect(screen.getByTestId("shift-closed-at")).not.toHaveTextContent("—");
    expect(screen.getByTestId("shift-close-day-review")).toBeInTheDocument();
  });

  it('distinguishes an actually-closed shift ("CLOSED") from no shift ever having existed ("NEVER OPENED") — previously both showed "CLOSED"', () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={null}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByTestId("shift-status-label")).toHaveTextContent(
      "NEVER OPENED",
    );
    expect(
      screen.getByText(
        "No shift is open. Open a shift to start the business day.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("shift-opened-at")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("shift-close-day-review"),
    ).not.toBeInTheDocument();
  });

  it("displays stored cash reconciliation with Balanced status", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={closedShift()}
        reconciliation={cashReconciliation()}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByTestId("expected-cash")).toHaveTextContent("€200.00");
    expect(screen.getByTestId("counted-cash")).toHaveTextContent("€200.00");
    expect(screen.getByTestId("cash-difference")).toHaveTextContent("€0.00");
    expect(screen.getByTestId("cash-reconciliation-status")).toHaveTextContent(
      "Balanced",
    );
    expect(
      screen.queryByTestId("missing-cash-reconciliation"),
    ).not.toBeInTheDocument();
  });

  it("displays cash Difference status from stored difference", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={closedShift()}
        reconciliation={cashReconciliation({
          counted_cash: 190,
          difference: -10,
        })}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByTestId("cash-difference")).toHaveTextContent("-€10.00");
    expect(screen.getByTestId("cash-reconciliation-status")).toHaveTextContent(
      "Difference",
    );
  });

  it("shows an informational state and the reconcile form when cash reconciliation is missing", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={closedShift()}
        reconciliation={null}
        onOpenShift={noop}
        onCloseShift={noop}
        onReconcileCash={vi.fn()}
      />,
    );

    expect(screen.getByTestId("missing-cash-reconciliation")).toHaveTextContent(
      /has not been recorded/i,
    );
    expect(screen.getByTestId("counted-cash-input")).toBeInTheDocument();
    expect(screen.queryByTestId("expected-cash")).not.toBeInTheDocument();
  });

  it("renders a historical closed Shift from stored immutable cash reconciliation only", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={closedShift({
          opened_at: "2025-01-10T08:00:00.000Z",
          closed_at: "2025-01-10T17:30:00.000Z",
        })}
        reconciliation={cashReconciliation({
          expected_cash: 80,
          counted_cash: 80,
          difference: 0,
        })}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByTestId("shift-status-label")).toHaveTextContent(
      "CLOSED",
    );
    expect(screen.getByTestId("expected-cash")).toHaveTextContent("€80.00");
    expect(screen.getByTestId("cash-reconciliation-status")).toHaveTextContent(
      "Balanced",
    );
  });

  // --- Loading/error/mutating states and the Open/Close/Reconcile actions.
  it("shows a loading state and disables both shift buttons", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        loading
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByText("Loading shift…")).toBeInTheDocument();
    expect(screen.getByTestId("open-shift-button")).toBeDisabled();
    expect(screen.getByTestId("close-shift-button")).toBeDisabled();
  });

  it("shows an error message with a Retry button that calls onRetry", () => {
    const onRetry = vi.fn();
    render(
      <ShiftStatusPanel
        activeShift={null}
        error="Shift information could not be loaded right now."
        onOpenShift={noop}
        onCloseShift={noop}
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByText("Shift information could not be loaded right now."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("open-shift-button")).toBeDisabled();
    expect(screen.getByTestId("close-shift-button")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not render a Retry button when onRetry is not provided", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        error="Shift information could not be loaded right now."
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
  });

  it("hides the Close Day Review section when an error is present, even for a closed shift", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={closedShift()}
        error="Shift information could not be loaded right now."
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(
      screen.queryByTestId("shift-close-day-review"),
    ).not.toBeInTheDocument();
  });

  it("renders shift notes when present and omits the Notes row when absent", () => {
    render(
      <ShiftStatusPanel
        activeShift={openShift({
          notes: "Register drawer started short by €2.",
        })}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );
    expect(
      screen.getByText("Register drawer started short by €2."),
    ).toBeInTheDocument();

    cleanup();

    render(
      <ShiftStatusPanel
        activeShift={openShift({ notes: null })}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );
    expect(screen.queryByText(/Register drawer/)).not.toBeInTheDocument();
  });

  it("enables Open Shift and disables Close Shift when no shift is open; clicking Open Shift calls onOpenShift", () => {
    const onOpenShift = vi.fn();
    const onCloseShift = vi.fn();
    render(
      <ShiftStatusPanel
        activeShift={null}
        onOpenShift={onOpenShift}
        onCloseShift={onCloseShift}
      />,
    );

    const openButton = screen.getByTestId("open-shift-button");
    const closeButton = screen.getByTestId("close-shift-button");
    expect(openButton).toBeEnabled();
    expect(closeButton).toBeDisabled();

    fireEvent.click(openButton);
    expect(onOpenShift).toHaveBeenCalledTimes(1);
    expect(onCloseShift).not.toHaveBeenCalled();
  });

  it("enables Close Shift and disables Open Shift when a shift is open; clicking Close Shift calls onCloseShift", () => {
    const onOpenShift = vi.fn();
    const onCloseShift = vi.fn();
    render(
      <ShiftStatusPanel
        activeShift={openShift()}
        onOpenShift={onOpenShift}
        onCloseShift={onCloseShift}
      />,
    );

    const openButton = screen.getByTestId("open-shift-button");
    const closeButton = screen.getByTestId("close-shift-button");
    expect(openButton).toBeDisabled();
    expect(closeButton).toBeEnabled();

    fireEvent.click(closeButton);
    expect(onCloseShift).toHaveBeenCalledTimes(1);
    expect(onOpenShift).not.toHaveBeenCalled();
  });

  it('shows "Opening…" while mutating and no shift is open, and "Closing…" while mutating and a shift is open', () => {
    const { rerender } = render(
      <ShiftStatusPanel
        activeShift={null}
        mutating
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );
    expect(screen.getByTestId("open-shift-button")).toHaveTextContent(
      "Opening…",
    );
    expect(screen.getByTestId("close-shift-button")).toHaveTextContent(
      "Close Shift",
    );

    rerender(
      <ShiftStatusPanel
        activeShift={openShift()}
        mutating
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );
    expect(screen.getByTestId("close-shift-button")).toHaveTextContent(
      "Closing…",
    );
    expect(screen.getByTestId("open-shift-button")).toHaveTextContent(
      "Open Shift",
    );
  });

  it("submits the typed counted cash value via onReconcileCash", () => {
    const onReconcileCash = vi.fn();
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={closedShift()}
        onOpenShift={noop}
        onCloseShift={noop}
        onReconcileCash={onReconcileCash}
      />,
    );

    fireEvent.change(screen.getByTestId("counted-cash-input"), {
      target: { value: "187.5" },
    });
    fireEvent.click(screen.getByTestId("reconcile-cash-button"));

    expect(onReconcileCash).toHaveBeenCalledTimes(1);
    expect(onReconcileCash).toHaveBeenCalledWith(187.5);
  });

  it("disables the Reconcile Cash button and input while mutating", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={closedShift()}
        mutating
        onOpenShift={noop}
        onCloseShift={noop}
        onReconcileCash={vi.fn()}
      />,
    );

    expect(screen.getByTestId("counted-cash-input")).toBeDisabled();
    expect(screen.getByTestId("reconcile-cash-button")).toBeDisabled();
    expect(screen.getByTestId("reconcile-cash-button")).toHaveTextContent(
      "Saving…",
    );
  });

  it("disables the Reconcile Cash button when onReconcileCash is not provided", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={closedShift()}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByTestId("reconcile-cash-button")).toBeDisabled();
  });

  it("shows the action error message when present, and omits it when absent", () => {
    const { rerender } = render(
      <ShiftStatusPanel
        activeShift={openShift()}
        actionError="Failed to close shift"
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );
    expect(screen.getByTestId("shift-action-error")).toHaveTextContent(
      "Failed to close shift",
    );

    rerender(
      <ShiftStatusPanel
        activeShift={openShift()}
        actionError={null}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );
    expect(
      screen.queryByTestId("shift-action-error"),
    ).not.toBeInTheDocument();
  });
});
