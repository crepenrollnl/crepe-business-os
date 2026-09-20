"use client";

import { useCallback, useState } from "react";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { authService } from "../services/auth-service";

export function useMyRole(): { role: string | null } {
  const [role, setRole] = useState<string | null>(null);

  const load = useCallback(async () => {
    const nextRole = await authService.getMyRole();
    setRole(nextRole);
  }, []);

  useAsyncEffect(load, [load]);

  return { role };
}
