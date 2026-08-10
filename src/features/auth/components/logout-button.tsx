"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/hooks/use-auth";

export function LogoutButton() {
  const { signOut } = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    await signOut();
    router.replace("/login");
  };

  return (
    <button
      type="button"
      onClick={() => void handleLogout()}
      className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
    >
      Logout
    </button>
  );
}
