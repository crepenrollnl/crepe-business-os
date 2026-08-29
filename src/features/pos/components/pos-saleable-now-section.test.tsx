import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SaleableNowRow } from "@/features/sales/utils/max-saleable-now";

const { useSaleableNowMock } = vi.hoisted(() => ({
  useSaleableNowMock: vi.fn(),
}));

vi.mock("../hooks/use-saleable-now", () => ({
  useSaleableNow: () => useSaleableNowMock(),
}));

import { PosSaleableNowSection } from "./pos-saleable-now-section";

function row(overrides?: Partial<SaleableNowRow>): SaleableNowRow {
  return {
    product_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    product_name: "Chicken Crepe",
    max_portions: 3,
    bottleneck_name: "Dough",
    bottleneck_kind: "component",
    ...overrides,
  };
}

describe("PosSaleableNowSection", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    useSaleableNowMock.mockReturnValue({
      rows: [row()],
      loading: false,
      error: null,
      retry: vi.fn(),
    });
  });

  it("renders product, portions, bottleneck, and the independent-figures disclaimer", () => {
    render(<PosSaleableNowSection />);

    expect(screen.getByRole("heading", { name: "Can sell now" })).toBeVisible();
    expect(screen.getByText("Chicken Crepe")).toBeVisible();
    expect(screen.getByText("3")).toBeVisible();
    expect(screen.getByText("Dough")).toBeVisible();
    expect(
      screen.getByText(
        "Figures are independent per product and must not be added together when dishes share ingredients or components.",
      ),
    ).toBeVisible();
  });

  it("shows a section error without blocking the rest of Stock", () => {
    useSaleableNowMock.mockReturnValue({
      rows: [],
      loading: false,
      error: "Failed to load saleable quantities",
      retry: vi.fn(),
    });

    render(<PosSaleableNowSection />);

    expect(
      screen.getByText("Failed to load saleable quantities"),
    ).toBeVisible();
    expect(screen.queryByText("Chicken Crepe")).not.toBeInTheDocument();
  });
});
