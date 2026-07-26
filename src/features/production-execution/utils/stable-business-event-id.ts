/**
 * Deterministic business-event ids for idempotent production posting (DEV-105).
 *
 * Journal persistence dedupes on business_event_id. A stable id derived from the
 * operational idempotency key prevents double-post on retry.
 */

import { createHash } from "node:crypto";

/** Fixed namespace for production-execution accounting events. */
const PRODUCTION_ACCOUNTING_NAMESPACE =
  "7c2f0b9e-4a61-5d83-9e10-2b8c4f6a1d35";

/**
 * RFC 4122 UUID v5-style id from an opaque string key.
 */
export function stableBusinessEventId(key: string): string {
  const hash = createHash("sha1")
    .update(PRODUCTION_ACCOUNTING_NAMESPACE)
    .update(key)
    .digest();

  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  const hex = hash.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
