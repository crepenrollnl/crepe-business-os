import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { useRoleMock, pathnameMock, replaceMock } = vi.hoisted(() => ({
  useRoleMock: vi.fn(),
  pathnameMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("@/hooks/use-role", () => ({
  useRole: () => useRoleMock(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => pathnameMock(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { RoleGuard } from "./role-guard";

function asRole(role: string | null, loading = false) {
  useRoleMock.mockReturnValue({ role, loading, reload: () => undefined });
}

function renderAt(pathname: string) {
  pathnameMock.mockReturnValue(pathname);
  const pageMounted = vi.fn();
  function Page() {
    pageMounted();
    return <div data-testid="page">Page</div>;
  }
  render(
    <RoleGuard>
      <Page />
    </RoleGuard>,
  );
  return { pageMounted };
}

describe("RoleGuard", () => {
  beforeEach(() => {
    useRoleMock.mockReset();
    pathnameMock.mockReset();
    replaceMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it.each([
    "/purchases",
    "/purchases/receipts",
    "/production-planning/plan-1",
    "/production-execution/sessions/s-1",
    "/accounting/profit-and-loss",
    "/expenses",
    "/fixed-assets",
    "/reports",
    "/reports/sales-by-product",
    "/reports/posting-failures",
    "/recipes/cost-report",
    "/inventory/ingredients/i-1/movements",
  ])("blocks a seller on %s without mounting the page", (path) => {
    asRole("seller");

    const { pageMounted } = renderAt(path);

    expect(pageMounted).not.toHaveBeenCalled();
    expect(screen.getByTestId("access-denied")).toHaveTextContent(
      "You don't have access to this page",
    );
    expect(screen.getByRole("link", { name: "Go to POS" })).toHaveAttribute(
      "href",
      "/pos",
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it.each(["/pos", "/sales", "/sales/quick", "/sales/sale-1", "/inventory", "/recipes"])(
    "lets a seller open %s",
    (path) => {
      asRole("seller");

      renderAt(path);

      expect(screen.getByTestId("page")).toBeInTheDocument();
    },
  );

  it.each(["owner", "partner"])("lets %s open every page", (role) => {
    for (const path of [
      "/",
      "/pos",
      "/sales/quick",
      "/purchases",
      "/reports/btw",
      "/inventory/ingredients/i-1/movements",
      "/recipes/cost-report",
      "/accounting/profit-and-loss",
    ]) {
      asRole(role);
      renderAt(path);
      expect(screen.getByTestId("page")).toBeInTheDocument();
      cleanup();
    }
  });

  it("sends a seller opening the dashboard straight to /pos", () => {
    asRole("seller");

    const { pageMounted } = renderAt("/");

    expect(replaceMock).toHaveBeenCalledWith("/pos");
    expect(pageMounted).not.toHaveBeenCalled();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
  });

  it("shows the loading state and mounts nothing while the role loads", () => {
    asRole(null, true);

    const { pageMounted } = renderAt("/pos");

    expect(pageMounted).not.toHaveBeenCalled();
    expect(screen.queryByTestId("access-denied")).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("blocks a user without a role everywhere, with an explanation", () => {
    asRole(null);

    const { pageMounted } = renderAt("/pos");

    expect(pageMounted).not.toHaveBeenCalled();
    expect(screen.getByTestId("access-denied")).toHaveTextContent(
      "Your account has no active role yet",
    );
  });
});
