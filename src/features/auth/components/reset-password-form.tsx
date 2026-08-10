"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { authService } from "@/features/auth/services/auth-service";
import { MIN_PASSWORD_LENGTH } from "@/constants/config";

const RECOVERY_GRACE_PERIOD_MS = 3000;

type LinkStatus = "checking" | "valid" | "invalid";

export function ResetPasswordForm() {
  const router = useRouter();
  const { loading, isPasswordRecovery, signOut } = useAuth();

  // "valid" is derived directly from isPasswordRecovery at render time.
  // The effect below only owns the "invalid after grace period" timer —
  // a genuine external-timer subscription, not state derivable from props.
  const [timedOut, setTimedOut] = useState(false);
  const linkStatus: LinkStatus = isPasswordRecovery
    ? "valid"
    : loading
      ? "checking"
      : timedOut
        ? "invalid"
        : "checking";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isPasswordRecovery || loading) {
      return;
    }

    // Supabase's PASSWORD_RECOVERY event can arrive a beat after the initial
    // session check resolves — wait out a short grace period before treating
    // the link as invalid rather than failing on the first render.
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, RECOVERY_GRACE_PERIOD_MS);

    return () => clearTimeout(timer);
  }, [isPasswordRecovery, loading]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError(null);

    let hasError = false;

    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
      hasError = true;
    } else {
      setPasswordError(null);
    }

    if (password !== confirmPassword) {
      setConfirmError("Passwords do not match");
      hasError = true;
    } else {
      setConfirmError(null);
    }

    if (hasError) {
      return;
    }

    setIsSubmitting(true);

    const result = await authService.updatePassword(password);

    if (!result.success) {
      setIsSubmitting(false);
      setSubmitError(
        result.error === "same_password"
          ? "New password must be different from your current password."
          : "Something went wrong. Please try again.",
      );
      return;
    }

    await signOut();
    router.replace("/login");
  };

  if (linkStatus === "checking") {
    return <p className="text-sm text-zinc-600">Checking your reset link...</p>;
  }

  if (linkStatus === "invalid") {
    return (
      <div>
        <p className="mb-4 text-sm text-red-600">
          This link is invalid or has expired.
        </p>
        <Link href="/login" className="text-sm text-zinc-600 underline hover:no-underline">
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <input
        type="password"
        placeholder="New password"
        className={`w-full rounded border p-3 ${passwordError ? "mb-1" : "mb-4"}`}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {passwordError && (
        <p className="mb-4 text-sm text-red-600">{passwordError}</p>
      )}

      <input
        type="password"
        placeholder="Confirm new password"
        className={`w-full rounded border p-3 ${confirmError ? "mb-1" : "mb-4"}`}
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
      />
      {confirmError && (
        <p className="mb-4 text-sm text-red-600">{confirmError}</p>
      )}

      {submitError && (
        <p className="mb-4 text-sm text-red-600">{submitError}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded bg-black p-3 text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Updating..." : "Update password"}
      </button>
    </form>
  );
}
