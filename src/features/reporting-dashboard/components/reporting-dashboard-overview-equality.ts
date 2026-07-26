import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";

type OverviewProps = {
  overview: ReportingOverview;
};

/**
 * Memo boundary for Composition → DataBinding → Widgets.
 * Compares the approved overview object identity only - no field recalculation.
 */
export function isSameOverviewProps(
  previous: OverviewProps,
  next: OverviewProps,
): boolean {
  return previous.overview === next.overview;
}
