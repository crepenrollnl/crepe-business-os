/**
 * Business Event Factory coverage (DEV-092).
 */

import { describe, expect, it } from "vitest";
import {
  createBusinessEvent,
  createPostingMetadata,
} from "./business-event-factory";

describe("createBusinessEvent (DEV-092)", () => {
  it("builds a pending business event for future operational modules", () => {
    const result = createBusinessEvent({
      event_type: "inventory_adjusted",
      source_module: "inventory",
      source_document_type: "inventory_adjustment",
      source_document_id: "adj-1",
      transaction_id: null,
      occurred_at: "2026-07-26T10:00:00.000Z",
      transaction_currency: "eur",
      base_currency: "eur",
      exchange_rate: 1,
      rate_date: "2026-07-26T00:00:00.000Z",
      amounts: {
        gross_amount: null,
        net_amount: 25,
        tax_amount: null,
        cogs_amount: null,
        discount_amount: null,
        shipping_amount: null,
        other_amount: 25,
      },
      nowIso: "2026-07-26T12:00:00.000Z",
      createId: () => "event-1",
    });

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      id: "event-1",
      event_type: "inventory_adjusted",
      source_module: "inventory",
      transaction_currency: "EUR",
      base_currency: "EUR",
      rate_date: "2026-07-26",
      posting_status: "pending",
      idempotency_key: "inventory_adjusted:adj-1",
    });
  });

  it("rejects missing source identity", () => {
    const result = createBusinessEvent({
      event_type: "waste_recognized",
      source_module: "inventory",
      source_document_type: "waste",
      source_document_id: "",
      transaction_id: null,
      occurred_at: "2026-07-26T10:00:00.000Z",
      transaction_currency: "EUR",
      base_currency: "EUR",
      exchange_rate: 1,
      rate_date: "2026-07-26",
      amounts: {
        gross_amount: null,
        net_amount: 5,
        tax_amount: null,
        cogs_amount: null,
        discount_amount: null,
        shipping_amount: null,
        other_amount: 5,
      },
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/source_document_id/i);
  });

  it("builds posting metadata from the event", () => {
    const eventResult = createBusinessEvent({
      event_type: "production_completed",
      source_module: "production-execution",
      source_document_type: "production_session",
      source_document_id: "session-1",
      transaction_id: "txn-9",
      occurred_at: "2026-07-26T10:00:00.000Z",
      transaction_currency: "EUR",
      base_currency: "EUR",
      exchange_rate: 1,
      rate_date: "2026-07-26",
      amounts: {
        gross_amount: null,
        net_amount: null,
        tax_amount: null,
        cogs_amount: 40,
        discount_amount: null,
        shipping_amount: null,
        other_amount: null,
      },
      createId: () => "event-prod",
      nowIso: "2026-07-26T12:00:00.000Z",
    });

    expect(eventResult.error).toBeNull();
    const metadata = createPostingMetadata({
      event: eventResult.data!,
      requested_at: "2026-07-26T12:00:00.000Z",
      correlation_id: "txn-9",
      tags: { flow: "production" },
    });

    expect(metadata).toEqual({
      source_module: "production-execution",
      source_document_type: "production_session",
      source_document_id: "session-1",
      idempotency_key: "production_completed:session-1",
      correlation_id: "txn-9",
      requested_at: "2026-07-26T12:00:00.000Z",
      tags: { flow: "production" },
    });
  });
});
