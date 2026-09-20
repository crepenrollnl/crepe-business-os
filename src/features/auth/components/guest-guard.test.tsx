import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { User } from "@supabase/supabase-js";

const { useAuthMock, replaceMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock("@/features/auth/hooks/use-auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

import { GuestGuard } from "./guest-guard";

function authState(overrides?: {
  user?: User | null;
  loading?: boolean;
  isPasswordRecovery?: boolean;
}) {
  return {
    user: null,
    loading: false,
    isPasswordRecovery: false,
    signOut: vi.fn(),
    ...overrides,
  };
}

describe("GuestGuard", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    replaceMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders AuthLoading and does not render children while loading", () => {
    useAuthMock.mockReturnValue(authState({ loading: true }));

    render(
      <GuestGuard>
        <div data-testid="guest-content">Guest</div>
      </GuestGuard>,
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByTestId("guest-content")).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects an already signed-in user home and does not render children", () => {
    useAuthMock.mockReturnValue(
      authState({ user: { id: "user-1" } as User }),
    );

    render(
      <GuestGuard>
        <div data-testid="guest-content">Guest</div>
      </GuestGuard>,
    );

    expect(screen.queryByTestId("guest-content")).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith("/");
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  it("renders children for a signed-out user and does not redirect", () => {
    useAuthMock.mockReturnValue(authState({ user: null, loading: false }));

    render(
      <GuestGuard>
        <div data-testid="guest-content">Guest</div>
      </GuestGuard>,
    );

    expect(screen.getByTestId("guest-content")).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
