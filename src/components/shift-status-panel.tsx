/**
 * Re-export so consuming modules go through the shared UI layer instead of
 * reaching into another module's `components/` directly (AGENTS.md module
 * boundary rule). Same shape as `layout/top-nav.tsx` importing
 * `LogoutButton`/`GlobalSearch` from their owning features -- the shifts
 * module still owns the component and its tests.
 */
export { ShiftStatusPanel } from "@/features/shifts/components/shift-status-panel";
