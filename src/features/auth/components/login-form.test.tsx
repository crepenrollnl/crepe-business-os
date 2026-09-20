import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { signInMock, pushMock, refreshMock } = vi.hoisted(() => ({
  signInMock: vi.fn(),
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/features/auth/services/auth-service", () => ({
  authService: {
    signIn: (...args: unknown[]) => signInMock(...args),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { LoginForm } from "./login-form";

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByPlaceholderText("Email"), {
    target: { value: email },
  });
  fireEvent.change(screen.getByPlaceholderText("Password"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: "Login" }));
}

describe("LoginForm", () => {
  beforeEach(() => {
    signInMock.mockReset();
    pushMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders email, password, and the Login button", () => {
    render(<LoginForm />);

    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Login" })).toBeInTheDocument();
  });

  it('shows "Invalid email or password" with role="alert" when sign-in fails', async () => {
    signInMock.mockResolvedValue({ success: false, error: "invalid_credentials" });

    render(<LoginForm />);
    fillAndSubmit("user@example.com", "wrong-password");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid email or password");
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("pushes home and refreshes after a successful sign-in", async () => {
    signInMock.mockResolvedValue({ success: true });

    render(<LoginForm />);
    fillAndSubmit("user@example.com", "correct-password");

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/");
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("disables the Login button while sign-in is in flight", async () => {
    let resolveSignIn: (value: { success: true }) => void = () => {};
    signInMock.mockReturnValue(
      new Promise<{ success: true }>((resolve) => {
        resolveSignIn = resolve;
      }),
    );

    render(<LoginForm />);
    fillAndSubmit("user@example.com", "correct-password");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Logging in..." })).toBeDisabled();
    });

    resolveSignIn({ success: true });

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/");
    });
  });

  it("shows a generic error and re-enables Login when signIn throws", async () => {
    signInMock.mockRejectedValueOnce(new Error("network down"));

    render(<LoginForm />);
    fillAndSubmit("user@example.com", "correct-password");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong. Please try again.");
    expect(screen.getByRole("button", { name: "Login" })).toBeEnabled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
