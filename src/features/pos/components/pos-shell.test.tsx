import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { PosShell } from "./pos-shell";

const { useRoleMock } = vi.hoisted(() => ({
  useRoleMock: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/logout-button", () => ({
  LogoutButton: () => <button type="button">Logout</button>,
}));

vi.mock("@/hooks/use-role", () => ({
  useRole: () => useRoleMock(),
}));

function asRole(role: string | null) {
  useRoleMock.mockReturnValue({ role, loading: false, reload: () => undefined });
}

function renderShell() {
  return render(
    <PosShell activeTab="sale" onTabChange={vi.fn()}>
      <p>Sale</p>
    </PosShell>,
  );
}

describe("PosShell receipts link", () => {
  afterEach(() => {
    cleanup();
    useRoleMock.mockReset();
  });

  it("shows Receipts to an owner", async () => {
    asRole("owner");
    renderShell();

    const link = await screen.findByRole("link", { name: "Receipts" });
    expect(link).toHaveAttribute("href", "/purchases/receipts");
  });

  it("shows Receipts to a partner", async () => {
    asRole("partner");
    renderShell();

    expect(await screen.findByRole("link", { name: "Receipts" })).toBeInTheDocument();
  });

  it("hides Receipts while the role is loading", () => {
    useRoleMock.mockReturnValue({ role: null, loading: true, reload: () => undefined });
    renderShell();

    expect(screen.queryByRole("link", { name: "Receipts" })).not.toBeInTheDocument();
  });

  it("hides Receipts from a seller", async () => {
    asRole("seller");
    renderShell();

    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Back to OS" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: "Receipts" })).not.toBeInTheDocument();
  });
});
