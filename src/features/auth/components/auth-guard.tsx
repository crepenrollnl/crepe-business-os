"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AuthLoading } from "@/features/auth/components/auth-loading";
import { useAuth } from "@/features/auth/hooks/use-auth";

type AuthGuardProps = {
  children: ReactNode;
};

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

  return <>{children}</>;
}
