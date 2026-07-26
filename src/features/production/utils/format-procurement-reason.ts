import type { ProcurementRecommendationReason } from "@/features/production-planning";

const PROCUREMENT_REASON_LABELS: Record<
  ProcurementRecommendationReason,
  string
> = {
  ExactQuantity: "Exact quantity",
  RoundedToPackage: "Rounded to package",
  MinimumOrder: "Minimum order",
  SupplierRestriction: "Supplier restriction",
  NoPackagingData: "No packaging data",
};

/** Human-readable procurement recommendation reason. */
export function formatProcurementReason(reason: string): string {
  if (reason in PROCUREMENT_REASON_LABELS) {
    return PROCUREMENT_REASON_LABELS[
      reason as ProcurementRecommendationReason
    ];
  }

  return reason;
}
