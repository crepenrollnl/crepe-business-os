/**
 * Sale detail page: COGS and profit sections are owner/partner only (S4/U5).
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SaleCostSummary } from "../types/sale-cogs";
import type { SaleProfitSummary } from "../types/sale-profit";
import type { SaleDetail } from "../types/sale";

const { useSaleMock, getRecipesMock } = vi.hoisted(() => ({
  useSaleMock: vi.fn(),
  getRecipesMock: vi.fn(),
}));

vi.mock("@/components/layout/dashboard-layout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/features/recipes/services/recipe-service", () => ({
  recipeService: {
    getRecipes: () => getRecipesMock(),
  },
}));

vi.mock("../hooks/use-sale", () => ({
  useSale: () => useSaleMock(),
}));

import { SaleDetailPage } from "./sale-detail-page";

const SALE: SaleDetail = {
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
  discount_type: null,
  discount_value: null,
  discount_amount: null,
  lines: [],
};

const COGS: SaleCostSummary = {
  sale_id: "sale-1",
  total_cogs: 40,
  consumed_quantity: 1,
  is_frozen: true,
  line_summaries: [],
  layers: [],
};

const PROFIT: SaleProfitSummary = {
  sale_id: "sale-1",
  net_revenue: 100,
  cogs: 40,
  gross_profit: 60,
  gross_margin_percent: 60,
  is_frozen: true,
};

function saleState(showCosts: boolean) {
  return {
    sale: SALE,
    loading: false,
    error: null,
    confirming: false,
    mutating: false,
    actionError: null,
    warning: null,
    lastConfirmCogs: null,
    cogsSummary: showCosts ? COGS : null,
    cogsLoading: false,
    cogsError: null,
    profitSummary: showCosts ? PROFIT : null,
    profitLoading: false,
    profitError: null,
    accountingPostingStatus: "posted" as const,
    showAccountingStatus: showCosts,
    showCosts,
    reviewLoading: false,
    addSaleLine: vi.fn(),
    updateSaleLine: vi.fn(),
    deleteSaleLine: vi.fn(),
    confirm: vi.fn(),
    retry: vi.fn(),
  };
}

describe("SaleDetailPage cost sections (S4/U5)", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows a seller the sale without any COGS or profit section", async () => {
    getRecipesMock.mockResolvedValue({ data: [], error: null });
    useSaleMock.mockReturnValue(saleState(false));

    render(<SaleDetailPage saleId="sale-1" />);

    await waitFor(() => expect(getRecipesMock).toHaveBeenCalled());
    expect(screen.getByTestId("sale-review-section")).toBeInTheDocument();
    expect(screen.queryByTestId("sale-cogs-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sale-profit-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-cogs")).not.toBeInTheDocument();
    expect(screen.queryByTestId("review-gross-profit")).not.toBeInTheDocument();
    expect(screen.queryByText(/cogs|gross profit|margin/i)).toBeNull();
  });

  it("shows the owner the COGS and profit sections", async () => {
    getRecipesMock.mockResolvedValue({ data: [], error: null });
    useSaleMock.mockReturnValue(saleState(true));

    render(<SaleDetailPage saleId="sale-1" />);

    await waitFor(() => expect(getRecipesMock).toHaveBeenCalled());
    expect(screen.getByTestId("sale-cogs-section")).toBeInTheDocument();
    expect(screen.getByTestId("sale-profit-section")).toBeInTheDocument();
    expect(screen.getByTestId("review-cogs")).toBeInTheDocument();
  });
});
