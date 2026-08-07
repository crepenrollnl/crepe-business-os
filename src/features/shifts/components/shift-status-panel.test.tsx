/**
 * Shift Details / Close Day review UI (DEV-116).
 *
 * Display-only for stored immutable summaries.
 * Missing summaries show informational states — never recalculated in the UI.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { CashReconciliation } from "../types/cash-reconciliation";
import type { DailyProfitSummary } from "../types/daily-profit-summary";
import type { DailySalesSummary } from "../types/daily-sales-summary";
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

function salesSummary(
  overrides?: Partial<DailySalesSummary>,
): DailySalesSummary {
  return {
    id: "sales-summary-1",
    shift_id: SHIFT_ID,
    sales_count: 4,
    items_sold: 12,
    gross_revenue: 242,
    net_revenue: 200,
    average_receipt: 60.5,
    generated_at: "2026-07-26T18:00:01.000Z",
    created_at: "2026-07-26T18:00:01.000Z",
    ...overrides,
  };
}

function profitSummary(
  overrides?: Partial<DailyProfitSummary>,
): DailyProfitSummary {
  return {
    id: "profit-summary-1",
    shift_id: SHIFT_ID,
    net_revenue: 200,
    total_cogs: 80,
    gross_profit: 120,
    gross_margin_percent: 60,
    generated_at: "2026-07-26T18:00:02.000Z",
    created_at: "2026-07-26T18:00:02.000Z",
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

  it("renders an active Shift without close-day summaries", () => {
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
    expect(
      screen.queryByTestId("daily-sales-summary-section"),
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

  it("displays stored sales summary values", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={closedShift()}
        dailySalesSummary={salesSummary()}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByTestId("sales-count")).toHaveTextContent("4");
    expect(screen.getByTestId("items-sold")).toHaveTextContent("12");
    expect(screen.getByTestId("gross-revenue")).toHaveTextContent("€242.00");
    expect(screen.getByTestId("net-revenue")).toHaveTextContent("€200.00");
    expect(
      screen.queryByTestId("missing-sales-summary"),
    ).not.toBeInTheDocument();
  });

  it("displays stored profit summary values", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={closedShift()}
        dailyProfitSummary={profitSummary()}
        onOpenShift={noop}
        onCloseShift={noop}
      />,
    );

    expect(screen.getByTestId("profit-net-revenue")).toHaveTextContent(
      "€200.00",
    );
    expect(screen.getByTestId("profit-total-cogs")).toHaveTextContent("€80.00");
    expect(screen.getByTestId("profit-gross-profit")).toHaveTextContent(
      "€120.00",
    );
    expect(screen.getByTestId("profit-gross-margin")).toHaveTextContent(
      "60.00%",
    );
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

  it("shows informational states when summaries are missing", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={closedShift()}
        dailySalesSummary={null}
        dailyProfitSummary={null}
        reconciliation={null}
        onOpenShift={noop}
        onCloseShift={noop}
        onReconcileCash={vi.fn()}
      />,
    );

    expect(screen.getByTestId("missing-sales-summary")).toHaveTextContent(
      /not available/i,
    );
    expect(screen.getByTestId("missing-profit-summary")).toHaveTextContent(
      /not available/i,
    );
    expect(screen.getByTestId("missing-cash-reconciliation")).toHaveTextContent(
      /has not been recorded/i,
    );
    expect(screen.getByTestId("counted-cash-input")).toBeInTheDocument();
    expect(screen.queryByTestId("sales-count")).not.toBeInTheDocument();
    expect(screen.queryByTestId("profit-total-cogs")).not.toBeInTheDocument();
    expect(screen.queryByTestId("expected-cash")).not.toBeInTheDocument();
  });

  it("renders a historical closed Shift from stored immutable values only", () => {
    render(
      <ShiftStatusPanel
        activeShift={null}
        closedShift={closedShift({
          opened_at: "2025-01-10T08:00:00.000Z",
          closed_at: "2025-01-10T17:30:00.000Z",
        })}
        dailySalesSummary={salesSummary({
          sales_count: 2,
          items_sold: 5,
          gross_revenue: 80,
          net_revenue: 80,
        })}
        dailyProfitSummary={profitSummary({
          net_revenue: 80,
          total_cogs: 25,
          gross_profit: 55,
          gross_margin_percent: 68.75,
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
    expect(screen.getByTestId("sales-count")).toHaveTextContent("2");
    expect(screen.getByTestId("gross-revenue")).toHaveTextContent("€80.00");
    expect(screen.getByTestId("profit-gross-profit")).toHaveTextContent(
      "€55.00",
    );
    expect(screen.getByTestId("profit-gross-margin")).toHaveTextContent(
      "68.75%",
    );
    expect(screen.getByTestId("expected-cash")).toHaveTextContent("€80.00");
    expect(screen.getByTestId("cash-reconciliation-status")).toHaveTextContent(
      "Balanced",
    );
  });
});
