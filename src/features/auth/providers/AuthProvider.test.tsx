import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

const { getSessionMock, onAuthStateChangeMock, signOutMock } = vi.hoisted(
  () => ({
    getSessionMock: vi.fn(),
    onAuthStateChangeMock: vi.fn(),
    signOutMock: vi.fn(),
  }),
);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (...args: unknown[]) =>
        onAuthStateChangeMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
    },
  },
}));

import { AuthProvider, useAuthContext } from "./AuthProvider";

type StateChangeCallback = (
  event: AuthChangeEvent,
  session: Session | null,
) => void;

function sessionFor(userId: string): Session {
  return {
    user: { id: userId },
  } as unknown as Session;
}

function AuthProbe() {
  const { user, loading, isPasswordRecovery } = useAuthContext();
  return (
    <div>
      <span data-testid="user">{user ? user.id : "null"}</span>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="recovery">{String(isPasswordRecovery)}</span>
    </div>
  );
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("AuthProvider (password recovery event handling)", () => {
  let capturedCallback: StateChangeCallback | undefined;

  beforeEach(() => {
    getSessionMock.mockReset();
    onAuthStateChangeMock.mockReset();
    signOutMock.mockReset();
    capturedCallback = undefined;

    getSessionMock.mockResolvedValue({ data: { session: null } });
    onAuthStateChangeMock.mockImplementation((callback: StateChangeCallback) => {
      capturedCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("initializes user/loading from getSession and defaults isPasswordRecovery to false", async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await flushMicrotasks();

    expect(screen.getByTestId("user")).toHaveTextContent("null");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("recovery")).toHaveTextContent("false");
  });

  it("SIGNED_IN sets user and leaves isPasswordRecovery untouched, exactly as before", async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await flushMicrotasks();

    act(() => {
      capturedCallback?.("SIGNED_IN", sessionFor("user-1"));
    });

    expect(screen.getByTestId("user")).toHaveTextContent("user-1");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
    expect(screen.getByTestId("recovery")).toHaveTextContent("false");
  });

  it("PASSWORD_RECOVERY sets isPasswordRecovery true and still sets user unconditionally, same as any other event", async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await flushMicrotasks();

    act(() => {
      capturedCallback?.("PASSWORD_RECOVERY", sessionFor("recovery-user"));
    });

    expect(screen.getByTestId("recovery")).toHaveTextContent("true");
    expect(screen.getByTestId("user")).toHaveTextContent("recovery-user");
  });

  it("SIGNED_OUT resets isPasswordRecovery back to false and clears user", async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await flushMicrotasks();

    act(() => {
      capturedCallback?.("PASSWORD_RECOVERY", sessionFor("recovery-user"));
    });
    expect(screen.getByTestId("recovery")).toHaveTextContent("true");

    act(() => {
      capturedCallback?.("SIGNED_OUT", null);
    });

    expect(screen.getByTestId("recovery")).toHaveTextContent("false");
    expect(screen.getByTestId("user")).toHaveTextContent("null");
  });

  it("TOKEN_REFRESHED (an unrelated event) does not flip isPasswordRecovery", async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await flushMicrotasks();

    act(() => {
      capturedCallback?.("TOKEN_REFRESHED", sessionFor("user-1"));
    });

    expect(screen.getByTestId("user")).toHaveTextContent("user-1");
    expect(screen.getByTestId("recovery")).toHaveTextContent("false");
  });
});
