import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

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
  afterEach(() => {
    cleanup();
  });

  it("shows Raw Materials by default inside the Inventory shell", () => {
    render(
      <InventoryWorkspacePage
        activeTab="raw-materials"
        finishedGoods={<div data-testid="finished-goods">embedded</div>}
      />,
    );

    expect(screen.getByTestId("dashboard-layout")).toHaveAttribute(
      "data-active-path",
      "/inventory",
    );
    expect(screen.getByTestId("raw-materials")).toHaveTextContent("embedded");
    expect(screen.queryByTestId("finished-goods")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Raw Materials" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("shows the Finished Goods slot when that tab is active", () => {
    render(
      <InventoryWorkspacePage
        activeTab="finished-goods"
        finishedGoods={<div data-testid="finished-goods">embedded</div>}
      />,
    );

    expect(screen.getByTestId("finished-goods")).toHaveTextContent("embedded");
    expect(screen.queryByTestId("raw-materials")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Finished Goods" }),
    ).toHaveAttribute("aria-current", "page");
  });
});
