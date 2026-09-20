"use client";

import { GuestGuard } from "@/features/auth/components/guest-guard";
import { LoginForm } from "@/features/auth/components/login-form";

export function LoginPage() {
  return (
    <GuestGuard>
      <div className="flex min-h-screen items-center justify-center bg-zinc-100">
        <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
          <h1 className="mb-6 text-center text-3xl font-bold">
            Crepe&apos;n Roll OS
          </h1>

          <LoginForm />
        </div>
      </div>
    </GuestGuard>
  );
}
