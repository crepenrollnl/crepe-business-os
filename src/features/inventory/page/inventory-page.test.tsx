/**
 * Inventory page by role (S4/U5 phase 2a): a seller gets the cost-free stock
 * view and never runs the owner data load (ingredients with costs,
 * suppliers, stock movements, purchase history).
 */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const {
  useRoleMock,
  useInventoryMock,
  useInventoryAdjustmentMock,
  useIngredientStockLevelsMock,
} = vi.hoisted(() => ({
  useRoleMock: vi.fn(),
  useInventoryMock: vi.fn(),
  useInventoryAdjustmentMock: vi.fn(),
  useIngredientStockLevelsMock: vi.fn(),
}));

vi.mock("@/hooks/use-role", () => ({
  useRole: () => useRoleMock(),
}));

vi.mock("@/components/layout/dashboard-layout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../hooks/use-inventory", () => ({
  useInventory: () => useInventoryMock(),
}));

vi.mock("../hooks/use-inventory-adjustment", () => ({
  useInventoryAdjustment: () => useInventoryAdjustmentMock(),
}));

vi.mock("../hooks/use-ingredient-stock-levels", () => ({
  useIngredientStockLevels: () => useIngredientStockLevelsMock(),
}));

vi.mock("../components/inventory-table", () => ({
  InventoryTable: () => <div data-testid="owner-inventory-table" />,
}));

vi.mock("../components/ingredient-modal", () => ({
  IngredientModal: () => null,
}));

vi.mock("../components/adjust-stock-modal", () => ({
  AdjustStockModal: () => null,
}));

vi.mock("../components/delete-dialog", () => ({
  DeleteDialog: () => null,
}));

import { InventoryPage } from "./inventory-page";

function asRole(role: string) {
  useRoleMock.mockReturnValue({ role, loading: false, reload: () => undefined });
}

const STOCK = {
  items: [
    {
      id: "i-1",
      name: "Flour",
      category_id: null,
      unit: "kg",
      current_stock: 4,
      minimum_stock: 2,
      active: true,
      category: null,
    },
  ],
  totalCount: 1,
  hasActiveFilters: false,
  categories: [],
  loading: false,
  error: null,
  search: "",
  setSearch: vi.fn(),
  categoryFilter: "",
  setCategoryFilter: vi.fn(),
  sortField: "name" as const,
  sortDirection: "asc" as const,
  toggleSort: vi.fn(),
  retry: vi.fn(),
};

const OWNER = {
  items: [],
  totalCount: 0,
  hasActiveFilters: false,
  purchasingReviews: new Map(),
  purchasingReviewMessages: [],
  lowStockAlerts: [],
  categories: [],
  suppliers: [],
  loading: false,
  error: null,
  search: "",
  setSearch: vi.fn(),
  categoryFilter: "",
  setCategoryFilter: vi.fn(),
  sortField: "name" as const,
  sortDirection: "asc" as const,
  toggleSort: vi.fn(),
  isModalOpen: false,
  editingItem: null,
  recipeUsageCount: null,
  isCheckingRecipeUsage: false,
  deleteTarget: null,
  isSaving: false,
  isDeleting: false,
  actionError: null,
  openCreateModal: vi.fn(),
  openEditModal: vi.fn(),
  closeModal: vi.fn(),
  openDeleteDialog: vi.fn(),
  closeDeleteDialog: vi.fn(),
  saveIngredient: vi.fn(),
  deleteIngredient: vi.fn(),
  retry: vi.fn(),
  refreshAfterAdjustment: vi.fn(),
};

describe("InventoryPage by role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useIngredientStockLevelsMock.mockReturnValue(STOCK);
    useInventoryMock.mockReturnValue(OWNER);
    useInventoryAdjustmentMock.mockReturnValue({
      canAdjustStock: true,
      adjustingItem: null,
      isAdjustModalOpen: false,
      isAdjusting: false,
      adjustError: null,
      openAdjustModal: vi.fn(),
      closeAdjustModal: vi.fn(),
      submitAdjustment: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("gives a seller the stock levels view without running the owner load", () => {
    asRole("seller");

    render(<InventoryPage embedded />);

    expect(useIngredientStockLevelsMock).toHaveBeenCalled();
    expect(useInventoryMock).not.toHaveBeenCalled();
    expect(useInventoryAdjustmentMock).not.toHaveBeenCalled();
    expect(screen.getByText("Flour")).toBeInTheDocument();
    expect(screen.queryByTestId("owner-inventory-table")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "+ Add Ingredient" }),
    ).not.toBeInTheDocument();
  });

  it.each(["owner", "partner"])("keeps the full Inventory for %s", (role) => {
    asRole(role);

    render(<InventoryPage embedded />);

    expect(useInventoryMock).toHaveBeenCalled();
    expect(useIngredientStockLevelsMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("owner-inventory-table")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ Add Ingredient" }),
    ).toBeInTheDocument();
  });
});
