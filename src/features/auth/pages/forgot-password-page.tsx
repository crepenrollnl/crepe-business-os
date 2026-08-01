import Link from "next/link";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";

export function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
        <h1 className="mb-2 text-center text-2xl font-bold">
          Reset your password
        </h1>
        <p className="mb-6 text-center text-sm text-zinc-600">
          Enter your email and we&apos;ll send you a link to reset your
          password.
        </p>

        <ForgotPasswordForm />

        <p className="mt-6 text-center text-sm text-zinc-600">
          <Link href="/login" className="underline hover:no-underline">
            Back to login
          </Link>
        </p>
      </div>
    </div>
  );
}
