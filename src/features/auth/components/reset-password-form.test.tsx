import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { useAuthMock, updatePasswordMock, replaceMock, signOutMock } = vi.hoisted(
  () => ({
    useAuthMock: vi.fn(),
    updatePasswordMock: vi.fn(),
    replaceMock: vi.fn(),
    signOutMock: vi.fn(),
  }),
);

vi.mock("@/features/auth/hooks/use-auth", () => ({
  useAuth: () => useAuthMock(),
}));

vi.mock("@/features/auth/services/auth-service", () => ({
  authService: {
    updatePassword: (...args: unknown[]) => updatePasswordMock(...args),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

import { ResetPasswordForm } from "./reset-password-form";

function fillAndSubmit(password: string, confirmPassword: string) {
  fireEvent.change(screen.getByPlaceholderText("New password"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByPlaceholderText("Confirm new password"), {
    target: { value: confirmPassword },
  });
  fireEvent.click(screen.getByRole("button", { name: /update password/i }));
}

describe("ResetPasswordForm (update-password error messaging)", () => {
  beforeEach(() => {
    useAuthMock.mockReset();
    updatePasswordMock.mockReset();
    replaceMock.mockReset();
    signOutMock.mockReset();

    useAuthMock.mockReturnValue({
      loading: false,
      isPasswordRecovery: true,
      signOut: signOutMock,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows a specific message when the new password matches the current one ("same_password")', async () => {
    updatePasswordMock.mockResolvedValue({
      success: false,
      error: "same_password",
    });

    render(<ResetPasswordForm />);

    fillAndSubmit("password123", "password123");

    await waitFor(() => {
      expect(
        screen.getByText(
          "New password must be different from your current password.",
        ),
      ).toBeInTheDocument();
    });

    expect(signOutMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("shows the generic message for any other update error, without leaking the technical reason", async () => {
    updatePasswordMock.mockResolvedValue({
      success: false,
      error: "unknown",
    });

    render(<ResetPasswordForm />);

    fillAndSubmit("password123", "password123");

    await waitFor(() => {
      expect(
        screen.getByText("Something went wrong. Please try again."),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText(
        "New password must be different from your current password.",
      ),
    ).not.toBeInTheDocument();
  });

  it("signs out and redirects to /login on success", async () => {
    updatePasswordMock.mockResolvedValue({ success: true });

    render(<ResetPasswordForm />);

    fillAndSubmit("password123", "password123");

    await waitFor(() => {
      expect(signOutMock).toHaveBeenCalledTimes(1);
    });

    expect(replaceMock).toHaveBeenCalledWith("/login");
  });
});
