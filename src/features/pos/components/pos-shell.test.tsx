import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { PosShell } from "./pos-shell";

const { getMyRole } = vi.hoisted(() => ({
  getMyRole: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/logout-button", () => ({
  LogoutButton: () => <button type="button">Logout</button>,
}));

vi.mock("@/features/auth/services/auth-service", () => ({
  authService: {
    getMyRole: () => getMyRole(),
  },
}));

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
    getMyRole.mockReset();
  });

  it("shows Receipts to an owner", async () => {
    getMyRole.mockResolvedValue("owner");
    renderShell();

    const link = await screen.findByRole("link", { name: "Receipts" });
    expect(link).toHaveAttribute("href", "/purchases/receipts");
  });

  it("shows Receipts to a partner", async () => {
    getMyRole.mockResolvedValue("partner");
    renderShell();

    expect(await screen.findByRole("link", { name: "Receipts" })).toBeInTheDocument();
  });

  it("hides Receipts from a seller", async () => {
    let resolveRole: (role: string) => void = () => undefined;
    getMyRole.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveRole = resolve;
        }),
    );
    renderShell();

    expect(screen.queryByRole("link", { name: "Receipts" })).not.toBeInTheDocument();
    resolveRole("seller");
    await waitFor(() => expect(getMyRole).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "Back to OS" })).toBeInTheDocument();
    });
    expect(screen.queryByRole("link", { name: "Receipts" })).not.toBeInTheDocument();
  });
});
