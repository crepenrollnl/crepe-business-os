/**
 * App Router loading fallback for the chromeless auth routes (/login,
 * /forgot-password, /reset-password), which never render DashboardLayout.
 * Overrides the shell-aware root `src/app/loading.tsx` for these segments.
 */
export function PlainRouteLoading() {
  return (
    <div
      className="flex min-h-screen items-center justify-center bg-zinc-100"
      role="status"
      aria-live="polite"
    >
      <p className="text-sm font-medium text-zinc-600">Loading…</p>
    </div>
  );
}
