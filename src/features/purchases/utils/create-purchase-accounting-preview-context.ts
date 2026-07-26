/**
 * Ephemeral Accounting context for Purchase receive → Journal Proposal (DEV-101).
 *
 * Purchases-owned glue so the UI can retain the proposal returned by
 * existing purchaseAccountingService.propose. Does not change Accounting modules.
 */

import type { AccountRoleBinding, FiscalPeriod } from "@/types/accounting";
import type { PurchaseAccountingContext } from "../types/purchase-accounting";

function openPeriodForDate(dateIso: string): FiscalPeriod {
  const dateOnly = dateIso.slice(0, 10);
  const year = Number(dateOnly.slice(0, 4)) || new Date().getFullYear();

  return {
    id: `preview-period-${year}`,
    name: `${year}`,
    start_date: `${year}-01-01`,
    end_date: `${year}-12-31`,
    status: "open",
    closed_at: null,
    created_at: `${year}-01-01T00:00:00.000Z",
  };
}

function previewBindings(asOf: string): AccountRoleBinding[] {
  return [
    {
      id: "preview-bind-inventory",
      role: "inventory_asset",
      account_id: "preview-acct-inventory",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "preview-bind-vat-input",
      role: "vat_input",
      account_id: "preview-acct-vat-input",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "preview-bind-ap",
      role: "accounts_payable",
      account_id: "preview-acct-ap",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
  ].map((row) => ({
    ...row,
    // Keep bindings valid for the purchase date window.
    effective_from: row.effective_from < asOf ? row.effective_from : asOf,
  }));
}

/**
 * Build a propose-only context used when receiving goods so the returned
 * Journal Proposal can be shown in Accounting Preview.
 */
export function createPurchaseAccountingPreviewContext(input: {
  currency: string;
  purchasedAt: string;
  baseCurrency?: string;
  exchangeRate?: number;
}): PurchaseAccountingContext {
  const dateOnly = input.purchasedAt.slice(0, 10);
  const accountIds = [
    "preview-acct-inventory",
    "preview-acct-vat-input",
    "preview-acct-ap",
  ] as const;

  const accountsById = Object.fromEntries(
    accountIds.map((id) => [
      id,
      { id, is_postable: true as const, is_active: true as const },
    ]),
  );

  return {
    fiscalPeriod: openPeriodForDate(dateOnly),
    accountRoleBindings: previewBindings(dateOnly),
    accountsById,
    baseCurrency: input.baseCurrency ?? input.currency,
    exchangeRate: input.exchangeRate ?? 1,
    rateDate: dateOnly,
  };
}
