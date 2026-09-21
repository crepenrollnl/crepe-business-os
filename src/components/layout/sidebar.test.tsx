"use client";

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { useMyRoleMock } = vi.hoisted(() => ({
  useMyRoleMock: vi.fn(),
}));

vi.mock("@/features/auth/hooks/use-my-role", () => ({
  useMyRole: () => useMyRoleMock(),
}));

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

describe("Sidebar posting-failures role gate", () => {
  beforeEach(() => {
    useMyRoleMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not show Posting Failures to a seller, and still shows ungated items", () => {
    useMyRoleMock.mockReturnValue({ role: "seller" });

    render(<Sidebar isOpen onClose={() => undefined} />);

    expect(
      screen.queryByRole("link", { name: "Posting Failures" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Profit and Loss" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reports" })).toBeInTheDocument();
  });

  it("shows Posting Failures to an owner", () => {
    useMyRoleMock.mockReturnValue({ role: "owner" });

    render(<Sidebar isOpen onClose={() => undefined} />);

    expect(
      screen.getByRole("link", { name: "Posting Failures" }),
    ).toHaveAttribute("href", "/reports/posting-failures");
    expect(screen.getByRole("link", { name: "Profit and Loss" })).toHaveAttribute(
      "href",
      "/accounting/profit-and-loss",
    );
  });
});
