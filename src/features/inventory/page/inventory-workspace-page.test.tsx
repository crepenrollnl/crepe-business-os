import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { useRoleMock } = vi.hoisted(() => ({
  useRoleMock: vi.fn(),
}));

vi.mock("@/hooks/use-role", () => ({
  useRole: () => useRoleMock(),
}));

function asRole(role: string | null) {
  useRoleMock.mockReturnValue({ role, loading: false, reload: () => undefined });
}

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    ...props
  }: {
    href: string;
    children: ReactNode;
    className?: string;
    "aria-current"?: "page";
  }) => (
    <a href={href} className={className} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/layout/dashboard-layout", () => ({
  DashboardLayout: ({
    children,
    activePath,
  }: {
    children: ReactNode;
    activePath?: string;
  }) => (
    <div data-testid="dashboard-layout" data-active-path={activePath}>
      {children}
    </div>
  ),
}));

vi.mock("./inventory-page", () => ({
  InventoryPage: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="raw-materials">{embedded ? "embedded" : "full"}</div>
  ),
}));

import { InventoryWorkspacePage } from "./inventory-workspace-page";

describe("InventoryWorkspacePage", () => {
  beforeEach(() => {
    asRole("owner");
  });

  afterEach(() => {
    cleanup();
  });

  it("shows Raw Materials by default inside the Inventory shell", () => {
    render(
      <InventoryWorkspacePage
        activeTab="raw-materials"
        finishedGoods={<div data-testid="finished-goods">embedded</div>}
        writeOffs={<div data-testid="write-offs">embedded</div>}
        writeOffRequests={<div data-testid="write-off-requests">queue</div>}
      />,
    );

    expect(screen.getByTestId("dashboard-layout")).toHaveAttribute(
      "data-active-path",
      "/inventory",
    );
    expect(screen.getByTestId("raw-materials")).toHaveTextContent("embedded");
    expect(screen.queryByTestId("finished-goods")).not.toBeInTheDocument();
    expect(screen.queryByTestId("write-offs")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Raw Materials" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("shows the Finished Goods slot when that tab is active", () => {
    render(
      <InventoryWorkspacePage
        activeTab="finished-goods"
        finishedGoods={<div data-testid="finished-goods">embedded</div>}
        writeOffs={<div data-testid="write-offs">embedded</div>}
        writeOffRequests={<div data-testid="write-off-requests">queue</div>}
      />,
    );

    expect(screen.getByTestId("finished-goods")).toHaveTextContent("embedded");
    expect(screen.queryByTestId("raw-materials")).not.toBeInTheDocument();
    expect(screen.queryByTestId("write-offs")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Finished Goods" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("shows the Write-offs slot when that tab is active", () => {
    render(
      <InventoryWorkspacePage
        activeTab="write-offs"
        finishedGoods={<div data-testid="finished-goods">embedded</div>}
        writeOffs={<div data-testid="write-offs">embedded</div>}
        writeOffRequests={<div data-testid="write-off-requests">queue</div>}
      />,
    );

    expect(screen.getByTestId("write-offs")).toHaveTextContent("embedded");
    expect(screen.queryByTestId("raw-materials")).not.toBeInTheDocument();
    expect(screen.queryByTestId("finished-goods")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Write-offs" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("gives a seller no Write-offs tab, even on ?tab=write-offs", () => {
    asRole("seller");

    render(
      <InventoryWorkspacePage
        activeTab="write-offs"
        finishedGoods={<div data-testid="finished-goods">embedded</div>}
        writeOffs={<div data-testid="write-offs">embedded</div>}
        writeOffRequests={<div data-testid="write-off-requests">queue</div>}
      />,
    );

    expect(screen.queryByRole("link", { name: "Write-offs" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("write-offs")).not.toBeInTheDocument();
    expect(screen.getByTestId("raw-materials")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Raw Materials" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Finished Goods" })).toBeInTheDocument();
  });

  it("shows the owner/partner write-off requests queue on the Requests tab", () => {
    render(
      <InventoryWorkspacePage
        activeTab="requests"
        finishedGoods={<div data-testid="finished-goods">embedded</div>}
        writeOffs={<div data-testid="write-offs">embedded</div>}
        writeOffRequests={<div data-testid="write-off-requests">queue</div>}
      />,
    );

    expect(screen.getByTestId("write-off-requests")).toHaveTextContent("queue");
    expect(screen.getByRole("link", { name: "Requests" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("gives a seller no Requests tab, even on ?tab=requests", () => {
    asRole("seller");

    render(
      <InventoryWorkspacePage
        activeTab="requests"
        finishedGoods={<div data-testid="finished-goods">embedded</div>}
        writeOffs={<div data-testid="write-offs">embedded</div>}
        writeOffRequests={<div data-testid="write-off-requests">queue</div>}
      />,
    );

    expect(screen.queryByRole("link", { name: "Requests" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("write-off-requests")).not.toBeInTheDocument();
    expect(screen.getByTestId("raw-materials")).toBeInTheDocument();
  });
});
