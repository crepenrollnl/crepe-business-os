/**
 * Generic Accounting Business Event Factory (DEV-092).
 *
 * Operational modules map domain facts into this factory input.
 * Accounting owns validation of shared financial intake fields.
 *
 * Does not resolve posting rules or write journals/ledger.
 */

import type {
  AccountingBusinessEvent,
  AccountingBusinessEventType,
  AccountingEventAmounts,
  AccountingEventTaxLine,
} from "@/types/accounting";
import { fail, ok, type ServiceResult } from "@/types/service";

export interface BusinessEventFactoryInput {
  event_type: AccountingBusinessEventType;
  source_module: string;
  source_document_type: string;
  source_document_id: string;
  transaction_id: string | null;
  occurred_at: string;
  transaction_currency: string;
  base_currency: string;
  exchange_rate: number;
  rate_date: string;
  amounts: AccountingEventAmounts;
  tax_lines?: readonly AccountingEventTaxLine[];
  /** Defaults to `${event_type}:${source_document_id}`. */
  idempotency_key?: string;
  nowIso?: string;
  createId?: () => string;
  event_id?: string;
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Build a pending Accounting Business Event from operational money facts.
 */
export function createBusinessEvent(
  input: BusinessEventFactoryInput,
): ServiceResult<AccountingBusinessEvent> {
  if (!hasText(input.event_type)) {
    return fail("Business event type is required.");
  }

  if (!hasText(input.source_module)) {
    return fail("Business event source_module is required.");
  }

  if (!hasText(input.source_document_type)) {
    return fail("Business event source_document_type is required.");
  }

  if (!hasText(input.source_document_id)) {
    return fail("Business event source_document_id is required.");
  }

  if (!hasText(input.occurred_at)) {
    return fail("Business event occurred_at is required.");
  }

  if (!hasText(input.transaction_currency)) {
    return fail("Business event transaction_currency is required.");
  }

  if (!hasText(input.base_currency)) {
    return fail("Business event base_currency is required.");
  }

  if (!hasText(input.rate_date)) {
    return fail("Business event rate_date is required.");
  }

  if (!isFiniteNumber(input.exchange_rate) || input.exchange_rate <= 0) {
    return fail("Exchange rate must be a finite number greater than zero.");
  }

  if (!input.amounts || typeof input.amounts !== "object") {
    return fail("Business event amounts are required.");
  }

  const createId = input.createId ?? (() => crypto.randomUUID());
  const nowIso = input.nowIso ?? new Date().toISOString();
  const idempotencyKey =
    input.idempotency_key ??
    `${input.event_type}:${input.source_document_id}`;

  const event: AccountingBusinessEvent = {
    id: input.event_id ?? createId(),
    event_type: input.event_type,
    transaction_id: input.transaction_id,
    source_module: input.source_module.trim(),
    source_document_type: input.source_document_type.trim(),
    source_document_id: input.source_document_id.trim(),
    idempotency_key: idempotencyKey,
    occurred_at: input.occurred_at,
    transaction_currency: input.transaction_currency.trim().toUpperCase(),
    base_currency: input.base_currency.trim().toUpperCase(),
    exchange_rate: input.exchange_rate,
    rate_date: input.rate_date.slice(0, 10),
    amounts: {
      gross_amount: input.amounts.gross_amount,
      net_amount: input.amounts.net_amount,
      tax_amount: input.amounts.tax_amount,
      cogs_amount: input.amounts.cogs_amount,
      discount_amount: input.amounts.discount_amount,
      shipping_amount: input.amounts.shipping_amount,
      other_amount: input.amounts.other_amount,
    },
    tax_lines: [...(input.tax_lines ?? [])],
    posting_status: "pending",
    journal_entry_id: null,
    failure_reason: null,
    created_at: nowIso,
  };

  return ok(event);
}

/**
 * Build posting metadata from a business event (or parallel source facts).
 */
export function createPostingMetadata(input: {
  event: Pick<
    AccountingBusinessEvent,
    | "source_module"
    | "source_document_type"
    | "source_document_id"
    | "idempotency_key"
  >;
  requested_at?: string;
  correlation_id?: string | null;
  tags?: Readonly<Record<string, string>>;
}): import("../types/operational-integration").OperationalPostingMetadata {
  return {
    source_module: input.event.source_module,
    source_document_type: input.event.source_document_type,
    source_document_id: input.event.source_document_id,
    idempotency_key: input.event.idempotency_key,
    correlation_id: input.correlation_id ?? null,
    requested_at: input.requested_at ?? new Date().toISOString(),
    ...(input.tags ? { tags: input.tags } : {}),
  };
}
