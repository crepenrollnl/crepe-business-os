"use client";

import { useState, type FormEvent } from "react";
import { authService } from "@/features/auth/services/auth-service";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFieldError(null);
    setSubmitError(null);

    const trimmedEmail = email.trim();

    if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail)) {
      setFieldError("Enter a valid email address");
      return;
    }

    setIsSubmitting(true);

    const result = await authService.requestPasswordReset(trimmedEmail);

    setIsSubmitting(false);

    if (!result.success) {
      setSubmitError("Something went wrong. Please try again.");
      return;
    }

    setIsSubmitted(true);
  };

  if (isSubmitted) {
    return (
      <p className="text-sm text-zinc-700">
        If an account exists for that email, a reset link has been sent.
      </p>
    );
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <input
        type="email"
        placeholder="Email"
        className={`w-full rounded border p-3 ${fieldError || submitError ? "mb-1" : "mb-4"}`}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      {fieldError && (
        <p className="mb-4 text-sm text-red-600">{fieldError}</p>
      )}

      {submitError && (
        <p className="mb-4 text-sm text-red-600">{submitError}</p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded bg-black p-3 text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}
