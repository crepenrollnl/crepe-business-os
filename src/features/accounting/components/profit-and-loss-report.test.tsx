"use client";

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { ProfitAndLossReport } from "../types/profit-and-loss";
import { ProfitAndLossReportView } from "./profit-and-loss-report";

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

function matchedLine(mismatch: boolean) {
  return {
    operational_amount: mismatch ? 100 : 80,
    ledger_amount: 80,
    mismatch,
  };
}

function report(
  overrides?: Partial<ProfitAndLossReport>,
): ProfitAndLossReport {
  return {
    period_start: "2026-09-01",
    period_end: "2026-09-30",
    revenue: 80,
    cogs: 20,
    gross_profit: 60,
    opex_breakdown: [
      {
        account_code: "6010",
        account_name: "Rent",
        amount: 10,
      },
    ],
    opex: 10,
    write_offs: 0,
    depreciation: 5,
    net_profit: 45,
    reconciliation: {
      sales_revenue: matchedLine(false),
      cogs: matchedLine(false),
      write_offs: matchedLine(false),
    },
    ...overrides,
  };
}

describe("ProfitAndLossReportView mismatch banner", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the warning banner when a reconciliation mismatch is true", () => {
    render(
      <ProfitAndLossReportView
        report={report({
          reconciliation: {
            sales_revenue: matchedLine(true),
            cogs: matchedLine(false),
            write_offs: matchedLine(false),
          },
        })}
        loading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );

    expect(
      screen.getByText(
        "Some operations in this period may not be reflected in postings — the figures below may be incomplete",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Posting Failures" }),
    ).toHaveAttribute("href", "/reports/posting-failures");
  });

  it("hides the warning banner when every reconciliation mismatch is false", () => {
    render(
      <ProfitAndLossReportView
        report={report()}
        loading={false}
        error={null}
        onRetry={() => undefined}
      />,
    );

    expect(
      screen.queryByText(
        "Some operations in this period may not be reflected in postings — the figures below may be incomplete",
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Posting Failures" }),
    ).not.toBeInTheDocument();
  });
});
