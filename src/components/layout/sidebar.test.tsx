"use client";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { useRoleMock, countPendingMock } = vi.hoisted(() => ({
  useRoleMock: vi.fn(),
  countPendingMock: vi.fn(),
}));

vi.mock(
  "@/features/write-off-requests/services/write-off-request-service",
  () => ({
    writeOffRequestService: {
      countPending: () => countPendingMock(),
    },
  }),
);

vi.mock("@/hooks/use-role", () => ({
  useRole: () => useRoleMock(),
}));

function asRole(role: string | null) {
  useRoleMock.mockReturnValue({ role, loading: false, reload: () => undefined });
}

function menuLabels(): string[] {
  return screen.getAllByRole("link").map((link) => link.textContent ?? "");
}

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

import { Sidebar } from "./sidebar";

describe("Sidebar role gate (route table, src/lib/navigation.ts)", () => {
  beforeEach(() => {
    useRoleMock.mockReset();
    countPendingMock.mockReset();
    countPendingMock.mockResolvedValue({ data: 0, error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a seller only POS, Quick Sale, Inventory, Recipes and Sales", () => {
    asRole("seller");

    render(<Sidebar isOpen onClose={() => undefined} />);

    expect(menuLabels()).toEqual([
      "POS",
      "Quick Sale",
      "Inventory",
      "Write-off requests",
      "Recipes",
      "Sales",
    ]);
  });

  it("does not show owner screens to a seller", () => {
    asRole("seller");

    render(<Sidebar isOpen onClose={() => undefined} />);

    expect(
      screen.queryByRole("link", { name: "Posting Failures" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Profit and Loss" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Recipe Cost" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Expenses" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Fixed Assets" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "BTW Report" }),
    ).not.toBeInTheDocument();
    for (const label of [
      "Dashboard",
      "Purchases",
      "Production Planning",
      "Production Execution",
      "Reports",
      "Sales by Product",
    ]) {
      expect(screen.queryByRole("link", { name: label })).not.toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "POS" })).toHaveAttribute("href", "/pos");
    expect(screen.getByRole("link", { name: "Quick Sale" })).toHaveAttribute(
      "href",
      "/sales/quick",
    );
  });

  it("shows nothing while the role is unknown", () => {
    asRole(null);

    render(<Sidebar isOpen onClose={() => undefined} />);

    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("shows every menu item to an owner", () => {
    asRole("owner");

    render(<Sidebar isOpen onClose={() => undefined} />);

    expect(menuLabels()).toEqual([
      "Dashboard",
      "POS",
      "Quick Sale",
      "Inventory",
      "Write-off requests",
      "Recipes",
      "Recipe Cost",
      "Purchases",
      "Production Planning",
      "Production Execution",
      "Sales",
      "Profit and Loss",
      "Expenses",
      "Fixed Assets",
      "BTW Report",
      "Posting Failures",
      "Reports",
      "Sales by Product",
    ]);
  });

  it("shows Posting Failures to an owner", () => {
    asRole("owner");

    render(<Sidebar isOpen onClose={() => undefined} />);

    expect(
      screen.getByRole("link", { name: "Posting Failures" }),
    ).toHaveAttribute("href", "/reports/posting-failures");
    expect(screen.getByRole("link", { name: "Profit and Loss" })).toHaveAttribute(
      "href",
      "/accounting/profit-and-loss",
    );
    expect(screen.getByRole("link", { name: "Recipe Cost" })).toHaveAttribute(
      "href",
      "/recipes/cost-report",
    );
    expect(screen.getByRole("link", { name: "Expenses" })).toHaveAttribute(
      "href",
      "/expenses",
    );
    expect(screen.getByRole("link", { name: "Fixed Assets" })).toHaveAttribute(
      "href",
      "/fixed-assets",
    );
    expect(screen.getByRole("link", { name: "BTW Report" })).toHaveAttribute(
      "href",
      "/reports/btw",
    );
  });

  it("shows Recipe Cost to a partner", () => {
    asRole("partner");

    render(<Sidebar isOpen onClose={() => undefined} />);

    expect(screen.getByRole("link", { name: "Recipe Cost" })).toHaveAttribute(
      "href",
      "/recipes/cost-report",
    );
    expect(screen.getByRole("link", { name: "Expenses" })).toHaveAttribute(
      "href",
      "/expenses",
    );
    expect(screen.getByRole("link", { name: "Fixed Assets" })).toHaveAttribute(
      "href",
      "/fixed-assets",
    );
    expect(screen.getByRole("link", { name: "BTW Report" })).toHaveAttribute(
      "href",
      "/reports/btw",
    );
  });

  it("shows the owner the number of pending write-off requests", async () => {
    asRole("owner");
    countPendingMock.mockResolvedValue({ data: 3, error: null });

    render(<Sidebar isOpen onClose={() => undefined} />);

    expect(
      await screen.findByTestId("nav-counter-pendingWriteOffRequests"),
    ).toHaveTextContent("3");
    expect(screen.getByRole("link", { name: /Write-off requests/ })).toHaveAttribute(
      "href",
      "/write-off-requests",
    );
  });

  it("hides the counter when nothing is pending", async () => {
    asRole("partner");
    countPendingMock.mockResolvedValue({ data: 0, error: null });

    render(<Sidebar isOpen onClose={() => undefined} />);

    await waitFor(() => expect(countPendingMock).toHaveBeenCalled());
    expect(
      screen.queryByTestId("nav-counter-pendingWriteOffRequests"),
    ).not.toBeInTheDocument();
  });

  it("never asks for the pending count for a seller", async () => {
    asRole("seller");

    render(<Sidebar isOpen onClose={() => undefined} />);

    expect(screen.getByRole("link", { name: "Write-off requests" })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(countPendingMock).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("nav-counter-pendingWriteOffRequests"),
    ).not.toBeInTheDocument();
  });

  it("reads the count again when write-off requests change", async () => {
    asRole("owner");
    countPendingMock
      .mockResolvedValueOnce({ data: 2, error: null })
      .mockResolvedValueOnce({ data: 1, error: null });

    render(<Sidebar isOpen onClose={() => undefined} />);
    expect(
      await screen.findByTestId("nav-counter-pendingWriteOffRequests"),
    ).toHaveTextContent("2");

    window.dispatchEvent(new Event("write-off-requests:changed"));

    await waitFor(() =>
      expect(
        screen.getByTestId("nav-counter-pendingWriteOffRequests"),
      ).toHaveTextContent("1"),
    );
  });
});
