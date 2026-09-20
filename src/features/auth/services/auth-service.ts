import { supabase } from "@/lib/supabase";

export type SignInCredentials = {
  email: string;
  password: string;
};

export type SignInResult =
  | { success: true }
  | { success: false; error: "invalid_credentials" };

export type RequestPasswordResetResult =
  | { success: true }
  | { success: false };

export type UpdatePasswordResult =
  | { success: true }
  | { success: false; error: "same_password" | "unknown" };

export const authService = {
  async signIn(credentials: SignInCredentials): Promise<SignInResult> {
    const { error } = await supabase.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password,
    });

    if (error) {
      return { success: false, error: "invalid_credentials" };
    }

    return { success: true };
  },

  async signOut(): Promise<void> {
    await supabase.auth.signOut();
  },

  async requestPasswordReset(email: string): Promise<RequestPasswordResetResult> {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (error) {
      return { success: false };
    }

    return { success: true };
  },

  async updatePassword(newPassword: string): Promise<UpdatePasswordResult> {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      return {
        success: false,
        error: error.code === "same_password" ? "same_password" : "unknown",
      };
    }

    return { success: true };
  },

  /**
   * Current user's application role from get_my_role() (sql/097).
   * Returns null when the RPC fails or the user has no active profile.
   */
  async getMyRole(): Promise<string | null> {
    try {
      const { data, error } = await supabase.rpc("get_my_role");
      if (error || typeof data !== "string") {
        return null;
      }

      const trimmed = data.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch {
      return null;
    }
  },
};
