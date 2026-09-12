/**
 * Deterministic business-event ids for idempotent purchases posting.
 *
 * Journal persistence dedupes on business_event_id. A stable id derived from the
 * operational idempotency key prevents double-post on retry.
 */

import { createHash } from "node:crypto";

/** Fixed namespace for purchases accounting events. */
const PURCHASES_ACCOUNTING_NAMESPACE = "b6e2f4a8-7c19-5d3e-a082-4f1b9e6c3a57";

/**
 * RFC 4122 UUID v5-style id from an opaque string key.
 */
export function stableBusinessEventId(key: string): string {
  const hash = createHash("sha1")
    .update(PURCHASES_ACCOUNTING_NAMESPACE)
    .update(key)
    .digest();

  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
