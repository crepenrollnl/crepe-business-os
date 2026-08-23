import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { FinishedGoodsTable } from "./finished-goods-table";
import type { FinishedGoodsListRow } from "../types/finished-good";

const row: FinishedGoodsListRow = {
  product_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  product_name: "Roasted chicken",
  available_quantity: 7,
  yield_unit: "kg",
  average_unit_cost: 4.5,
  remaining_value: 31.5,
  newest_batch_at: "2026-08-22T10:00:00.000Z",
  production_status: "available",
};

const noop = () => undefined;

describe("FinishedGoodsTable", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders product remaining quantity, cost, value, and newest batch", () => {
    render(
      <FinishedGoodsTable
        items={[row]}
        totalCount={1}
        filteredCount={1}
        hasActiveFilters={false}
        loading={false}
        error={null}
        sortField="product_name"
        sortDirection="asc"
        page={1}
        totalPages={1}
        pageSize={25}
        onSort={noop}
        onRetry={noop}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    );

    expect(screen.getByText("Roasted chicken")).toBeInTheDocument();
    expect(screen.getByText("7 kg")).toBeInTheDocument();
    expect(screen.getByText("€4.5000")).toBeInTheDocument();
    expect(screen.getByText("€31.50")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
  });

  it("shows a read-only empty state without create actions", () => {
    render(
      <FinishedGoodsTable
        items={[]}
        totalCount={0}
        filteredCount={0}
        hasActiveFilters={false}
        loading={false}
        error={null}
        sortField="product_name"
        sortDirection="asc"
        page={1}
        totalPages={1}
        pageSize={25}
        onSort={noop}
        onRetry={noop}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    );

    expect(screen.getByText("No finished goods yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add/i })).not.toBeInTheDocument();
  });

  it("shows the error state with retry", () => {
    render(
      <FinishedGoodsTable
        items={[]}
        totalCount={0}
        filteredCount={0}
        hasActiveFilters={false}
        loading={false}
        error="Failed to load finished goods summary"
        sortField="product_name"
        sortDirection="asc"
        page={1}
        totalPages={1}
        pageSize={25}
        onSort={noop}
        onRetry={noop}
        onPageChange={noop}
        onPageSizeChange={noop}
      />,
    );

    expect(screen.getByText("Failed to load finished goods")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
