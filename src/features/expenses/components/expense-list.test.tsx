import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ExpenseList } from "./expense-list";
import type { ExpenseEntryWithRelations } from "../types/expense";

function expense(
  overrides?: Partial<ExpenseEntryWithRelations>,
): ExpenseEntryWithRelations {
  return {
    id: "expense-1",
    expense_date: "2026-08-03",
    account_id: "account-6060",
    description: "Diesel fill-up",
    supplier: "Shell",
    net_amount: 100,
    vat_amount: 21,
    gross_amount: 121,
    journal_entry_id: "journal-1",
    created_at: "2026-08-03T10:00:00.000Z",
    created_by: "user-1",
    account: { id: "account-6060", code: "6060", name: "Fuel & Transport" },
    posting_number: "JE-2026-000001",
    ...overrides,
  };
}

describe("ExpenseList", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a loading skeleton while loading", () => {
    render(
      <ExpenseList expenses={[]} loading error={null} onRetry={vi.fn()} />,
    );

    expect(screen.queryByText("No expenses yet")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no expenses", () => {
    render(
      <ExpenseList
        expenses={[]}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("No expenses yet")).toBeInTheDocument();
  });

  it("shows the error state and calls onRetry", () => {
    const onRetry = vi.fn();
    render(
      <ExpenseList
        expenses={[]}
        loading={false}
        error="Failed to load expenses."
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Failed to load expenses.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders a row with category, supplier, gross amount, and posting number", () => {
    render(
      <ExpenseList
        expenses={[expense()]}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("6060 — Fuel & Transport")).toBeInTheDocument();
    expect(screen.getByText("Shell")).toBeInTheDocument();
    expect(screen.getByText("€121.00")).toBeInTheDocument();
    expect(screen.getByText("JE-2026-000001")).toBeInTheDocument();
  });

  it("shows a 'Not posted' indicator when posting_number is missing", () => {
    render(
      <ExpenseList
        expenses={[expense({ posting_number: null, journal_entry_id: null })]}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Not posted")).toBeInTheDocument();
  });

  it("falls back to a dash when supplier or account is missing", () => {
    render(
      <ExpenseList
        expenses={[expense({ supplier: null, account: null })]}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });
});
