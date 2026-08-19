/**
 * Re-export so consuming modules go through the shared UI layer instead of
 * reaching into another module's `components/` directly (AGENTS.md module
 * boundary rule). Same shape as `shift-status-panel.tsx` — the sales
 * module still owns the component.
 */
export { QuickSaleTileGrid } from "@/features/sales/components/quick-sale-tile-grid";
