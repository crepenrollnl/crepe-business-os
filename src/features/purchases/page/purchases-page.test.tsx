import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { getMyRoleMock, useCountMock, getPurchaseReceiptAccessToken } = vi.hoisted(() => ({
  getMyRoleMock: vi.fn(),
  useCountMock: vi.fn(),
  getPurchaseReceiptAccessToken: vi.fn(),
}));

vi.mock("@/components/layout/dashboard-layout", () => ({
  DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../components/purchase-document-modal", () => ({
  PurchaseDocumentModal: () => null,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: ReactNode;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/features/auth/services/auth-service", () => ({
  authService: {
    getMyRole: () => getMyRoleMock(),
  },
}));

vi.mock("../utils/purchase-receipt-access-token", () => ({
  getPurchaseReceiptAccessToken: () => getPurchaseReceiptAccessToken(),
}));

vi.mock("../hooks/use-purchases", () => ({
  usePurchases: () => ({
    items: [],
    totalCount: 0,
    hasActiveFilters: false,
    suppliers: [],
    ingredients: [],
    loading: false,
    error: null,
    search: "",
    setSearch: vi.fn(),
    supplierFilter: "",
    setSupplierFilter: vi.fn(),
    statusFilter: "",
    setStatusFilter: vi.fn(),
    sortField: "purchased_at",
    sortDirection: "desc",
    toggleSort: vi.fn(),
    isModalOpen: false,
    editingPurchase: null,
    initialFormValues: null,
    isLoadingPurchase: false,
    isSaving: false,
    actionError: null,
    postingError: null,
    accountingPreview: null,
    openCreateModal: vi.fn(),
    openPurchaseModal: vi.fn(),
    closeModal: vi.fn(),
    saveDraft: vi.fn(),
    receiveGoods: vi.fn(),
    retry: vi.fn(),
  }),
}));

vi.mock("../hooks/use-purchase-receipts", () => ({
  useUnassignedReceiptCount: (enabled: boolean) => useCountMock(enabled),
}));

import { PurchasesPage } from "./purchases-page";

describe("PurchasesPage receipts entry", () => {
  afterEach(() => {
    cleanup();
    getMyRoleMock.mockReset();
    useCountMock.mockReset();
    getPurchaseReceiptAccessToken.mockReset();
    getPurchaseReceiptAccessToken.mockResolvedValue(null);
  });

  it("hides the Receipts button from a seller", async () => {
    getMyRoleMock.mockResolvedValue("seller");
    useCountMock.mockReturnValue({ count: 4 });

    render(<PurchasesPage />);

    await waitFor(() => {
      expect(useCountMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(useCountMock.mock.calls.every(([enabled]) => enabled === false)).toBe(true);
    expect(screen.queryByRole("link", { name: /Receipts/ })).not.toBeInTheDocument();
    expect(getPurchaseReceiptAccessToken).not.toHaveBeenCalled();
  });

  it("shows the Receipts button and the unassigned count to an owner", async () => {
    getMyRoleMock.mockResolvedValue("owner");
    useCountMock.mockReturnValue({ count: 4 });

    render(<PurchasesPage />);

    const link = await screen.findByRole("link", { name: /Receipts/ });
    expect(link).toHaveAttribute("href", "/purchases/receipts");
    expect(link).toHaveTextContent("4");
    expect(useCountMock).toHaveBeenCalledWith(true);
  });
});
