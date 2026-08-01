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

import { AuthGuard } from "./auth-guard";

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

describe("AuthGuard (recovery-session gating)", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    replaceMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders children for a normal, non-recovery signed-in user (unchanged behavior)", () => {
    useAuthMock.mockReturnValue(
      authState({ user: { id: "user-1" } as User, isPasswordRecovery: false }),
    );

    render(
      <AuthGuard>
        <div data-testid="protected-content">Protected</div>
      </AuthGuard>,
    );

    expect(screen.getByTestId("protected-content")).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("shows loading state and does not redirect while loading (unchanged behavior)", () => {
    useAuthMock.mockReturnValue(authState({ loading: true }));

    render(
      <AuthGuard>
        <div data-testid="protected-content">Protected</div>
      </AuthGuard>,
    );

    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects to /login when there is no user (unchanged behavior)", () => {
    useAuthMock.mockReturnValue(authState({ user: null }));

    render(
      <AuthGuard>
        <div data-testid="protected-content">Protected</div>
      </AuthGuard>,
    );

    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith("/login");
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  it("redirects to /reset-password (not /login) during a password recovery session, without rendering children", () => {
    useAuthMock.mockReturnValue(
      authState({ user: { id: "recovery-user" } as User, isPasswordRecovery: true }),
    );

    render(
      <AuthGuard>
        <div data-testid="protected-content">Protected</div>
      </AuthGuard>,
    );

    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith("/reset-password");
    expect(replaceMock).toHaveBeenCalledTimes(1);
  });

  it("does not redirect at all while loading, even if a recovery session is already known", () => {
    useAuthMock.mockReturnValue(
      authState({ loading: true, isPasswordRecovery: true, user: { id: "recovery-user" } as User }),
    );

    render(
      <AuthGuard>
        <div data-testid="protected-content">Protected</div>
      </AuthGuard>,
    );

    expect(replaceMock).not.toHaveBeenCalled();
  });
});
