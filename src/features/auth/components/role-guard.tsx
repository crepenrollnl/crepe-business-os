"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AuthLoading } from "@/features/auth/components/auth-loading";
import { useRole } from "@/hooks/use-role";
import { canAccessPath, SELLER_HOME_PATH } from "@/lib/navigation";

/**
 * Page guard driven by the route table in src/lib/navigation.ts (the same
 * table the menu uses). Children — and so every data request of the page —
 * mount only when the role may open the current path. A seller opening the
 * dashboard ("/") goes straight to the POS.
 */
export function RoleGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { role, loading } = useRole();

  const allowed = !loading && canAccessPath(pathname, role);
  const sendHome =
    !loading &&
    !allowed &&
    pathname === "/" &&
    canAccessPath(SELLER_HOME_PATH, role);

  useEffect(() => {
    if (sendHome) {
      router.replace(SELLER_HOME_PATH);
    }
  }, [router, sendHome]);

  if (loading || sendHome) {
    return <AuthLoading />;
  }

  if (!allowed) {
    return <AccessDenied hasRole={role !== null} />;
  }

  return <>{children}</>;
}

function AccessDenied({ hasRole }: { hasRole: boolean }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <div
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-8 text-center shadow-sm"
        data-testid="access-denied"
        role="alert"
      >
        <h1 className="text-lg font-semibold text-zinc-900">
          You don&apos;t have access to this page
        </h1>
        <p className="mt-2 text-sm text-zinc-600">
          {hasRole
            ? "This page is for the owner or a partner."
            : "Your account has no active role yet. Ask the owner to set it up."}
        </p>
        <Link
          href={SELLER_HOME_PATH}
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
        >
          Go to POS
        </Link>
      </div>
    </div>
  );
}
