"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AuthLoading } from "@/features/auth/components/auth-loading";
import { useAuth } from "@/features/auth/hooks/use-auth";

type GuestGuardProps = {
  children: ReactNode;
};

export function GuestGuard({ children }: GuestGuardProps) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [user, loading, router]);

  if (loading || user) {
    return <AuthLoading />;
  }

  return <>{children}</>;
}
