import { formatMonthYear } from "@/lib/date";
import type { DepreciationRunDetail } from "../types/fixed-asset";

/**
 * Unique, chronologically sorted "Mon YYYY" labels for every period a
 * catch-up run posted to, e.g. ["Jun 2026", "Jul 2026", "Aug 2026"] ->
 * "Jun 2026, Jul 2026, Aug 2026". Several assets can share the same period —
 * de-duplicated so the banner reads as a period list, not one row per asset.
 */
export function formatDepreciationPeriods(
  details: readonly DepreciationRunDetail[],
): string {
  const uniquePeriods = [...new Set(details.map((detail) => detail.period))].sort();

  return uniquePeriods.map((period) => formatMonthYear(period)).join(", ");
}
