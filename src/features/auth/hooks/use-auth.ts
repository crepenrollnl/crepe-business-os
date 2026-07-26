"use client";

import { useAuthContext } from "@/features/auth/providers/AuthProvider";

export function useAuth() {
  return useAuthContext();
}
