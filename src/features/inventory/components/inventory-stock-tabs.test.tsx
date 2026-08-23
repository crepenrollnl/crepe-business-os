import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { InventoryStockTabs } from "./inventory-stock-tabs";

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

describe("InventoryStockTabs", () => {
  afterEach(() => {
    cleanup();
  });

  it("marks Raw Materials current on the default inventory href", () => {
    render(<InventoryStockTabs activeTab="raw-materials" />);

    const raw = screen.getByRole("link", { name: "Raw Materials" });
    const finished = screen.getByRole("link", { name: "Finished Goods" });

    expect(raw).toHaveAttribute("href", "/inventory");
    expect(raw).toHaveAttribute("aria-current", "page");
    expect(finished).toHaveAttribute("href", "/inventory?tab=finished-goods");
    expect(finished).not.toHaveAttribute("aria-current");
  });

  it("marks Finished Goods current for the tab query", () => {
    render(<InventoryStockTabs activeTab="finished-goods" />);

    expect(
      screen.getByRole("link", { name: "Finished Goods" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: "Raw Materials" }),
    ).not.toHaveAttribute("aria-current");
  });
});
