/**
 * Sale Details Profit UI (DEV-110).
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SaleProfitSummary } from "../types/sale-profit";
import { SaleProfitSection } from "./sale-profit-section";

function summary(
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

describe("SaleProfitSection (DEV-110)", () => {
  afterEach(() => {
    cleanup();
  });

  it("displays revenue, COGS, gross profit, and margin %", () => {
    render(<SaleProfitSection summary={summary()} />);

    expect(screen.getByTestId("sale-net-revenue")).toHaveTextContent("€100.00");
    expect(screen.getByTestId("sale-profit-cogs")).toHaveTextContent("€40.00");
    expect(screen.getByTestId("sale-gross-profit")).toHaveTextContent("€60.00");
    expect(screen.getByTestId("sale-gross-margin")).toHaveTextContent("60.00%");
  });

  it("displays negative profit and dash margin for zero revenue", () => {
    render(
      <SaleProfitSection
        summary={summary({
          net_revenue: 0,
          cogs: 12,
          gross_profit: -12,
          gross_margin_percent: null,
        })}
      />,
    );

    expect(screen.getByTestId("sale-gross-profit")).toHaveTextContent("€-12.00");
    expect(screen.getByTestId("sale-gross-margin")).toHaveTextContent("—");
  });
});
