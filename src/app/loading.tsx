import { DashboardLayout } from "@/components/layout/dashboard-layout";

function DashboardLoadingSkeleton() {
  return (
    <div
      className="mx-auto max-w-7xl space-y-6"
      role="status"
      aria-live="polite"
    >
      <span className="sr-only">Loading…</span>

      <div className="space-y-2">
        <div className="h-8 w-64 animate-pulse rounded bg-zinc-200" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-zinc-200" />
      </div>

      <div className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="h-4 w-full animate-pulse rounded bg-zinc-200" />
        <div className="h-4 w-5/6 animate-pulse rounded bg-zinc-200" />
        <div className="h-4 w-2/3 animate-pulse rounded bg-zinc-200" />
      </div>
    </div>
  );
}

/**
 * App Router loading fallback, shown while a route segment is still being
 * prepared (Next dev-mode on-demand compilation, a slow Supabase cold
 * start, etc.) -- before the destination page has mounted and taken over
 * with its own internal loading state, which this does not replace.
 *
 * Reuses the real DashboardLayout shell (sidebar + top nav) so navigation
 * between shell pages never drops to a blank screen or loses the sidebar;
 * only the content area shows a skeleton. The chromeless auth routes
 * (/login, /forgot-password, /reset-password) override this with their own
 * loading.tsx, since they never render the dashboard shell.
 */
export default function Loading() {
  return (
    <DashboardLayout>
      <DashboardLoadingSkeleton />
    </DashboardLayout>
  );
}
