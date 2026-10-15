import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { useAuthMock, getMyRoleMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  getMyRoleMock: vi.fn(),
}));

vi.mock("@/features/auth/hooks/use-auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/features/auth/services/auth-service", () => ({
  authService: {
    getMyRole: () => getMyRoleMock(),
  },
}));

import { useRole } from "@/hooks/use-role";
import { RoleProvider } from "./RoleProvider";

function Probe({ id }: { id: string }) {
  const { role, loading } = useRole();
  return (
    <span data-testid={id}>
      {loading ? "loading" : (role ?? "none")}
    </span>
  );
}

function signedIn(userId: string | null, loading = false) {
  useAuthMock.mockReturnValue({
    user: userId ? { id: userId } : null,
    loading,
    isPasswordRecovery: false,
    signOut: vi.fn(),
  });
}

describe("RoleProvider", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    getMyRoleMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("reads the role once and shares it with every reader", async () => {
    signedIn("user-1");
    getMyRoleMock.mockResolvedValue("seller");

    render(
      <RoleProvider>
        <Probe id="a" />
        <Probe id="b" />
        <Probe id="c" />
      </RoleProvider>,
    );

    expect(screen.getByTestId("a")).toHaveTextContent("loading");
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("seller"));
    expect(screen.getByTestId("b")).toHaveTextContent("seller");
    expect(screen.getByTestId("c")).toHaveTextContent("seller");
    expect(getMyRoleMock).toHaveBeenCalledTimes(1);
  });

  it("stays loading while the session is loading and does not read the role", () => {
    signedIn(null, true);

    render(
      <RoleProvider>
        <Probe id="a" />
      </RoleProvider>,
    );

    expect(screen.getByTestId("a")).toHaveTextContent("loading");
    expect(getMyRoleMock).not.toHaveBeenCalled();
  });

  it("has no role when signed out", () => {
    signedIn(null);

    render(
      <RoleProvider>
        <Probe id="a" />
      </RoleProvider>,
    );

    expect(screen.getByTestId("a")).toHaveTextContent("none");
    expect(getMyRoleMock).not.toHaveBeenCalled();
  });

  it("reads the role again when another user signs in", async () => {
    signedIn("owner-user");
    getMyRoleMock.mockResolvedValueOnce("owner").mockResolvedValueOnce("seller");

    const { rerender } = render(
      <RoleProvider>
        <Probe id="a" />
      </RoleProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("owner"));

    signedIn("seller-user");
    rerender(
      <RoleProvider>
        <Probe id="a" />
      </RoleProvider>,
    );

    // Never shows the previous user's role for the new user.
    expect(screen.getByTestId("a")).toHaveTextContent("loading");
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("seller"));
    expect(getMyRoleMock).toHaveBeenCalledTimes(2);
  });
});
