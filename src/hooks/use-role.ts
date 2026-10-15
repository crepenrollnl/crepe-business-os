"use client";

import { createContext, useContext } from "react";

export interface RoleContextValue {
  /** profiles.role of the signed-in user (get_my_role), or null. */
  role: string | null;
  /** True until the role of the current user is known. */
  loading: boolean;
  /** Read the role again (e.g. after a failed read). */
  reload: () => void;
}

/**
 * Filled by RoleProvider (src/features/auth/providers/RoleProvider.tsx),
 * which reads the role once per login. Kept here, apart from the provider,
 * so every module can read the role without loading the Supabase client.
 */
export const RoleContext = createContext<RoleContextValue | null>(null);

/** The signed-in user's role, read once per login by RoleProvider. */
export function useRole(): RoleContextValue {
  const context = useContext(RoleContext);

  if (!context) {
    throw new Error("useRole must be used within RoleProvider");
  }

  return context;
}
