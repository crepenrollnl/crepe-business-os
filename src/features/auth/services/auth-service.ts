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
};
