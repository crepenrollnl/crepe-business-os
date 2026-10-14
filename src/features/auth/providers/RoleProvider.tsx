"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/features/auth/hooks/use-auth";
import { authService } from "@/features/auth/services/auth-service";
import { RoleContext, type RoleContextValue } from "@/hooks/use-role";

interface LoadedRole {
  userId: string;
  role: string | null;
}

/**
 * Reads the signed-in user's role once per login and shares it with the
 * whole app, so the menu, page guard and screens never ask separately.
 */
export function RoleProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [loaded, setLoaded] = useState<LoadedRole | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (userId === null) {
      return;
    }

    let cancelled = false;
    void authService.getMyRole().then((role) => {
      if (!cancelled) {
        setLoaded({ userId, role });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  const reload = useCallback(() => {
    setLoaded(null);
    setAttempt((current) => current + 1);
  }, []);

  const isCurrent = userId !== null && loaded?.userId === userId;

  const value = useMemo<RoleContextValue>(
    () => ({
      role: isCurrent && loaded ? loaded.role : null,
      loading: authLoading || (userId !== null && !isCurrent),
      reload,
    }),
    [authLoading, isCurrent, loaded, reload, userId],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}
