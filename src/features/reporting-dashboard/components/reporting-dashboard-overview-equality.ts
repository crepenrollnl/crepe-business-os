import type { ReportingOverview } from "@/features/reporting-api/types/reporting-api";

type OverviewProps = {
  overview: ReportingOverview;
};

/**
 * Memo comparator for Composition → DataBinding → Widgets.
 * Uses overview object identity only.
 */
export function isSameOverviewProps(
  previous: OverviewProps,
  next: OverviewProps,
): boolean {
  return previous.overview === next.overview;
}
