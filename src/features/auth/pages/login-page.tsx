"use client";

import { GuestGuard } from "@/features/auth/components/guest-guard";
import { LoginForm } from "@/features/auth/components/login-form";
import { LoginLogo } from "@/features/auth/components/login-logo";

export function LoginPage() {
  return (
    <GuestGuard>
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-12">
        <div className="w-full max-w-md">
          <LoginLogo />

          <div className="mt-10 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
            <LoginForm />
          </div>
        </div>
      </div>
    </GuestGuard>
  );
}
