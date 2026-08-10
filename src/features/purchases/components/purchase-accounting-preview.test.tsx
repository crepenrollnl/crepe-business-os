/**
 * Purchase Accounting Preview UI coverage (DEV-101).
 *
 * Display-only — no Tax / Accounting / Posting service calls.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { PurchaseAccountingPreview } from "./purchase-accounting-preview";
import type { PurchaseAccountingPreviewData } from "../types/purchase-accounting-preview";

function previewWithProposal(
  overrides?: Partial<PurchaseAccountingPreviewData>,
): PurchaseAccountingPreviewData {
  return {
    net_amount: 100,
    tax_total: 21,
    grand_total: 121,
    currency: "EUR",
    status: "draft_proposal",
    has_proposal: true,
    lines: [
      {
        account_role: "inventory_asset",
        debit: 100,
        credit: 0,
        currency: "EUR",
      },
      {
        account_role: "vat_input",
        debit: 21,
        credit: 0,
        currency: "EUR",
      },
      {
        account_role: "accounts_payable",
        debit: 0,
        credit: 121,
        currency: "EUR",
      },
    ],
    ...overrides,
  };
}

function previewWithoutProposal(): PurchaseAccountingPreviewData {
  return {
    net_amount: 80,
    tax_total: 0,
    grand_total: 80,
    currency: "EUR",
    status: "draft_proposal",
    has_proposal: false,
    lines: [],
  };
}

describe("PurchaseAccountingPreview (DEV-101)", () => {
  afterEach(() => {
    cleanup();
  });

  it("is collapsed by default", () => {
    render(<PurchaseAccountingPreview preview={previewWithProposal()} />);

    expect(screen.getByRole("button", { name: /accounting preview/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.queryByTestId("purchase-accounting-preview-panel"),
    ).not.toBeInTheDocument();
  });

  it("shows tax totals when expanded", () => {
    render(
      <PurchaseAccountingPreview
        preview={previewWithProposal()}
        defaultOpen
      />,
    );

    expect(screen.getByText("Net Amount")).toBeInTheDocument();
    expect(screen.getByText("EUR 100.00")).toBeInTheDocument();
    expect(screen.getByText("Tax Total")).toBeInTheDocument();
    expect(screen.getByText("EUR 21.00")).toBeInTheDocument();
    expect(screen.getByText("Grand Total")).toBeInTheDocument();
    expect(screen.getByText("EUR 121.00")).toBeInTheDocument();
  });

  it("shows journal proposal lines when a proposal exists", () => {
    render(
      <PurchaseAccountingPreview
        preview={previewWithProposal()}
        defaultOpen
      />,
    );

    expect(screen.getByText("Journal Proposal")).toBeInTheDocument();
    expect(screen.getAllByText("Draft Proposal").length).toBeGreaterThan(0);
    expect(screen.getByText("inventory_asset")).toBeInTheDocument();
    expect(screen.getByText("vat_input")).toBeInTheDocument();
    expect(screen.getByText("accounts_payable")).toBeInTheDocument();
    expect(screen.getByText("100.00")).toBeInTheDocument();
    expect(screen.getByText("21.00")).toBeInTheDocument();
    expect(screen.getByText("121.00")).toBeInTheDocument();
    expect(screen.getAllByText("EUR")).toHaveLength(3);
  });

  it("shows empty state when no proposal is available", () => {
    render(
      <PurchaseAccountingPreview
        preview={previewWithoutProposal()}
        defaultOpen
      />,
    );

    expect(screen.getAllByText("EUR 80.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("EUR 0.00")).toBeInTheDocument();
    expect(
      screen.getByTestId("purchase-accounting-preview-empty"),
    ).toHaveTextContent(/no journal proposal available/i);
    expect(screen.queryByText("inventory_asset")).not.toBeInTheDocument();
  });

  it("expands and collapses on header click", () => {
    render(<PurchaseAccountingPreview preview={previewWithProposal()} />);

    const toggle = screen.getByRole("button", { name: /accounting preview/i });
    expect(
      screen.queryByTestId("purchase-accounting-preview-panel"),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(
      screen.getByTestId("purchase-accounting-preview-panel"),
    ).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(
      screen.queryByTestId("purchase-accounting-preview-panel"),
    ).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
