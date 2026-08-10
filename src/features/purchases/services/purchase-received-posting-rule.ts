/**
 * Re-export Accounting-owned Purchase Received posting rule (DEV-092).
 *
 * Rule resolution lives in Accounting. Purchases must not own posting rules.
 */

export {
  PURCHASE_RECEIVED_POSTING_RULE_ID,
  createPurchaseReceivedPostingRule,
} from "@/features/accounting/rules/purchase-received-posting-rule";
