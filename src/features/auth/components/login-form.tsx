"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authService } from "@/features/auth/services/auth-service";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const result = await authService.signIn({ email, password });

      if (!result.success) {
        setError("Invalid email or password");
        setIsSubmitting(false);
        return;
      }

      router.push("/");
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        placeholder="Email"
        className="mb-4 w-full rounded border p-3"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />

      <div className="relative mb-2">
        <input
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          placeholder="Password"
          className="w-full rounded border p-3 pr-11"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <button
          type="button"
          onClick={() => setShowPassword((current) => !current)}
          aria-label={showPassword ? "Hide password" : "Show password"}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500 hover:text-zinc-700"
        >
          {showPassword ? (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
              <path d="M2 2l20 20" />
            </svg>
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>

      <div className="mb-4 text-right text-sm">
        <Link href="/forgot-password" className="text-zinc-600 underline hover:no-underline">
          Forgot password?
        </Link>
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full rounded bg-black p-3 text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Logging in..." : "Login"}
      </button>
    </form>
  );
}
