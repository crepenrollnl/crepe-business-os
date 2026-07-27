/**
 * Sale Details review UI (DEV-111).
 *
 * Display-only — no financial recalculation in the UI.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SaleCostSummary } from "../types/sale-cogs";
import type { SaleProfitSummary } from "../types/sale-profit";
import type { SaleDetail } from "../types/sale";
import { SaleReviewSection } from "./sale-review-section";

function sale(overrides?: Partial<SaleDetail>): SaleDetail {
  return {
    sale_id: "sale-1",
    sale_number: "S-100",
    status: "confirmed",
    sale_date: "2026-07-26",
    customer_id: null,
    subtotal: 100,
    tax_total: 21,
    total: 121,
    confirmed_at: "2026-07-26T14:30:00.000Z",
    paid_at: null,
    cancelled_at: null,
    lines: [],
    ...overrides,
  };
}

function cogsSummary(
  overrides?: Partial<SaleCostSummary>,
): SaleCostSummary {
  return {
    sale_id: "sale-1",
    total_cogs: 40,
    consumed_quantity: 9,
    is_frozen: true,
    line_summaries: [],
    layers: [
      {
        consumption_id: "c-1",
        sale_line_id: "line-1",
        production_batch_id: "batch-a",
        batch_number: 1,
        quantity: 5,
        unit_cost: 2,
        total_cost: 10,
        produced_at: "2026-07-01T08:00:00.000Z",
      },
      {
        consumption_id: "c-2",
        sale_line_id: "line-1",
        production_batch_id: "batch-b",
        batch_number: 2,
        quantity: 4,
        unit_cost: 3,
        total_cost: 12,
        produced_at: "2026-07-02T08:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

function profitSummary(
  overrides?: Partial<SaleProfitSummary>,
): SaleProfitSummary {
  return {
    sale_id: "sale-1",
    net_revenue: 100,
    cogs: 40,
    gross_profit: 60,
    gross_margin_percent: 60,
    is_frozen: true,
    ...overrides,
  };
}

describe("SaleReviewSection (DEV-111)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders completed sale review: totals, COGS, profit, batches, posting, date", () => {
    render(
      <SaleReviewSection
        sale={sale()}
        cogsSummary={cogsSummary()}
        profitSummary={profitSummary()}
        accountingPostingStatus="posted"
      />,
    );

    expect(screen.getByTestId("review-sale-total")).toHaveTextContent(
      "€121.00",
    );
    expect(screen.getByTestId("review-net-revenue")).toHaveTextContent(
      "€100.00",
    );
    expect(screen.getByTestId("review-vat")).toHaveTextContent("€21.00");
    expect(screen.getByTestId("review-cogs")).toHaveTextContent("€40.00");
    expect(screen.getByTestId("review-gross-profit")).toHaveTextContent(
      "€60.00",
    );
    expect(screen.getByTestId("review-gross-margin")).toHaveTextContent(
      "60.00%",
    );
    expect(screen.getByTestId("review-accounting-status")).toHaveTextContent(
      "✓ Posted",
    );

    const expectedDate = new Date("2026-07-26T14:30:00.000Z").toLocaleString(
      undefined,
      {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      },
    );
    expect(screen.getByTestId("review-completion-date")).toHaveTextContent(
      expectedDate,
    );

    const batches = screen.getByTestId("review-consumed-batches");
    expect(within(batches).getByText("#1")).toBeInTheDocument();
    expect(within(batches).getByText("#2")).toBeInTheDocument();
    expect(within(batches).getByText("€2.0000")).toBeInTheDocument();
    expect(within(batches).getByText("€10.00")).toBeInTheDocument();
  });

  it("renders draft sale without frozen COGS/profit/posting", () => {
    render(
      <SaleReviewSection
        sale={sale({
          status: "draft",
          confirmed_at: null,
          total: 50,
          subtotal: 50,
          tax_total: 0,
        })}
      />,
    );

    expect(screen.getByTestId("sale-review-section")).toHaveTextContent(
      /confirm this sale/i,
    );
    expect(screen.getByTestId("review-sale-total")).toHaveTextContent("€50.00");
    expect(screen.queryByTestId("review-cogs")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("review-accounting-status"),
    ).not.toBeInTheDocument();
  });

  it("shows Pending when accounting posting is missing", () => {
    render(
      <SaleReviewSection
        sale={sale()}
        cogsSummary={cogsSummary()}
        profitSummary={profitSummary()}
        accountingPostingStatus="pending"
      />,
    );

    expect(screen.getByTestId("review-accounting-status")).toHaveTextContent(
      "Pending",
    );
  });

  it("handles missing COGS and missing profit summary", () => {
    render(
      <SaleReviewSection
        sale={sale()}
        cogsSummary={null}
        profitSummary={null}
        cogsError="Sale has no Finished Goods consumption layers for COGS."
        profitError="Failed to load sale profit"
        accountingPostingStatus="pending"
      />,
    );

    expect(screen.getByTestId("review-cogs")).toHaveTextContent("—");
    expect(screen.getByTestId("review-gross-profit")).toHaveTextContent("—");
    expect(screen.getByTestId("review-gross-margin")).toHaveTextContent("—");
    expect(screen.getByTestId("review-missing-cogs")).toHaveTextContent(
      /no finished goods consumption/i,
    );
    expect(screen.getByTestId("review-missing-profit")).toHaveTextContent(
      /failed to load sale profit/i,
    );
    expect(screen.getByTestId("review-consumed-batches")).toHaveTextContent(
      /batch consumption is unavailable/i,
    );
  });

  it("supports historical completed sales with frozen values", () => {
    render(
      <SaleReviewSection
        sale={sale({
          status: "paid",
          confirmed_at: "2025-01-10T09:05:00.000Z",
          paid_at: "2025-01-10T10:00:00.000Z",
          subtotal: 80,
          tax_total: 0,
          total: 80,
        })}
        cogsSummary={cogsSummary({ total_cogs: 25 })}
        profitSummary={profitSummary({
          net_revenue: 80,
          cogs: 25,
          gross_profit: 55,
          gross_margin_percent: 68.75,
        })}
        accountingPostingStatus="posted"
      />,
    );

    expect(screen.getByTestId("review-net-revenue")).toHaveTextContent(
      "€80.00",
    );
    expect(screen.getByTestId("review-cogs")).toHaveTextContent("€25.00");
    expect(screen.getByTestId("review-gross-profit")).toHaveTextContent(
      "€55.00",
    );
    expect(screen.getByTestId("review-gross-margin")).toHaveTextContent(
      "68.75%",
    );
    expect(screen.getByTestId("review-accounting-status")).toHaveTextContent(
      "✓ Posted",
    );
  });
});
