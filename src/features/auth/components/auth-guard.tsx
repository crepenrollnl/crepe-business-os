"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AuthLoading } from "@/features/auth/components/auth-loading";
import { RoleGuard } from "@/features/auth/components/role-guard";
import { useAuth } from "@/features/auth/hooks/use-auth";

type AuthGuardProps = {
  children: ReactNode;
};

/**
 * Signed-in check for every app page, followed by the role check
 * (RoleGuard, route table in src/lib/navigation.ts), so no page can be
 * added without both.
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const { user, loading, isPasswordRecovery } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) {
      return;
    }

    if (!user) {
      router.replace("/login");
      return;
    }

    if (isPasswordRecovery) {
      router.replace("/reset-password");
    }
  }, [user, loading, isPasswordRecovery, router]);

  if (loading || !user || isPasswordRecovery) {
    return <AuthLoading />;
  }

  return <RoleGuard>{children}</RoleGuard>;
}
