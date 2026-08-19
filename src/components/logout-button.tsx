/**
 * Re-export so consuming modules go through the shared UI layer instead of
 * reaching into another module's `components/` directly (AGENTS.md module
 * boundary rule). Same shape as `shift-status-panel.tsx` — the auth
 * module still owns the component. `layout/top-nav.tsx` may keep its
 * direct import; it lives in `src/components`.
 */
export { LogoutButton } from "@/features/auth/components/logout-button";
