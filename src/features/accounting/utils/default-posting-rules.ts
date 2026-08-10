/**
 * Default Posting Rule registry for operational event types (DEV-092 / DEV-093).
 *
 * Accounting alone resolves which rules apply when an operational module
 * omits an explicit postingRules override.
 *
 * Future Production / Inventory / Waste rules register here.
 */

import type {
  AccountingBusinessEventType,
  PostingRule,
} from "@/types/accounting";
import { createCogsRecognizedPostingRule } from "../rules/cogs-recognized-posting-rule";
import { createProductionAdjustedPostingRule } from "../rules/production-adjusted-posting-rule";
import { createProductionCompletedPostingRule } from "../rules/production-completed-posting-rule";
import { createPurchaseReceivedPostingRule } from "../rules/purchase-received-posting-rule";
import { createSaleCompletedRevenuePostingRule } from "../rules/sale-completed-posting-rule";

/**
 * Resolve the default posting rule set for an event type.
 * Returns an empty list when no default exists yet (engine will reject).
 */
export function resolveDefaultPostingRules(
  eventType: AccountingBusinessEventType,
): readonly PostingRule[] {
  switch (eventType) {
    case "purchase_received":
      return [createPurchaseReceivedPostingRule()];
    case "sale_completed":
      return [createSaleCompletedRevenuePostingRule()];
    case "cogs_recognized":
      return [createCogsRecognizedPostingRule()];
    case "production_completed":
      return [createProductionCompletedPostingRule()];
    case "production_adjusted":
      return [createProductionAdjustedPostingRule()];
    // Future:
    // case "inventory_adjusted":
    // case "waste_recognized":
    default:
      return [];
  }
}

/**
 * Prefer explicit overrides; otherwise use Accounting defaults.
 */
export function resolvePostingRulesForRequest(
  eventType: AccountingBusinessEventType,
  override?: readonly PostingRule[],
): readonly PostingRule[] {
  if (override !== undefined) {
    return override;
  }
  return resolveDefaultPostingRules(eventType);
}
