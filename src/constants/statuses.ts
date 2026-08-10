/**
 * Shared status value catalogs and display labels.
 *
 * Feature modules own domain-specific status unions. Use these constants
 * when a status is reused across modules or needs a stable label map.
 */

import type {
  ActivationStatus,
  DocumentLifecycleStatus,
  StockAvailabilityStatus,
} from "@/types/erp";

export const DOCUMENT_LIFECYCLE_STATUSES = [
  "draft",
  "posted",
  "cancelled",
  "voided",
] as const satisfies readonly DocumentLifecycleStatus[];

export const ACTIVATION_STATUSES = [
  "active",
  "inactive",
  "archived",
] as const satisfies readonly ActivationStatus[];

export const STOCK_AVAILABILITY_STATUSES = [
  "ok",
  "low",
  "out",
] as const satisfies readonly StockAvailabilityStatus[];

export const DOCUMENT_LIFECYCLE_LABELS: Record<
  DocumentLifecycleStatus,
  string
> = {
  draft: "Draft",
  posted: "Posted",
  cancelled: "Cancelled",
  voided: "Voided",
};

export const ACTIVATION_STATUS_LABELS: Record<ActivationStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

export const STOCK_AVAILABILITY_LABELS: Record<
  StockAvailabilityStatus,
  string
> = {
  ok: "In stock",
  low: "Low stock",
  out: "Out of stock",
};
