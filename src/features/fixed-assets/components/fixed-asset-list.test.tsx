import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { FixedAssetList } from "./fixed-asset-list";
import type { FixedAssetWithDepreciation } from "../types/fixed-asset";

function asset(
  overrides?: Partial<FixedAssetWithDepreciation>,
): FixedAssetWithDepreciation {
  return {
    id: "asset-1",
    name: "Food truck",
    purchase_date: "2026-01-15",
    cost: 24000,
    useful_life_months: 60,
    is_active: true,
    created_at: "2026-01-15T10:00:00.000Z",
    depreciated_amount: 1200,
    remaining_value: 22800,
    ...overrides,
  };
}

describe("FixedAssetList", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a loading skeleton while loading", () => {
    render(
      <FixedAssetList assets={[]} loading error={null} onRetry={vi.fn()} />,
    );

    expect(screen.queryByText("No fixed assets yet")).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no assets", () => {
    render(
      <FixedAssetList
        assets={[]}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("No fixed assets yet")).toBeInTheDocument();
  });

  it("shows the error state and calls onRetry", () => {
    const onRetry = vi.fn();
    render(
      <FixedAssetList
        assets={[]}
        loading={false}
        error="Failed to load fixed assets."
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByText("Failed to load fixed assets."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders a row with name, cost, depreciated, and remaining", () => {
    render(
      <FixedAssetList
        assets={[asset()]}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Food truck")).toBeInTheDocument();
    expect(screen.getByText("€24,000.00")).toBeInTheDocument();
    expect(screen.getByText("€1,200.00")).toBeInTheDocument();
    expect(screen.getByText("€22,800.00")).toBeInTheDocument();
  });

  it("shows a fully depreciated asset with remaining value 0", () => {
    render(
      <FixedAssetList
        assets={[asset({ depreciated_amount: 24000, remaining_value: 0 })]}
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("€0.00")).toBeInTheDocument();
  });
});
