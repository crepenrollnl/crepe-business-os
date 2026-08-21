/**
 * Inclusive-probe for exclusive Line total → net unit_cost.
 * RPC is mocked (no live DB). draftToValues proves save path stays exclusive.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormDraft } from "../components/purchase-document-modal";
import { draftToValues } from "../components/purchase-document-modal";
import {
  LINE_TOTAL_PROBE_LINE_ID,
  LINE_TOTAL_UNIT_PRICE_ERROR,
  deriveExclusiveUnitCostFromLineTotal,
} from "./derive-exclusive-unit-cost-from-line-total";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn() },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

function rpcInclusive109At21Percent() {
  return {
    data: {
      currency: "EUR",
      subtotal: 90.08,
      tax_total: 18.92,
      grand_total: 109,
      effective_tax_rate: 0.21,
      is_valid: true,
      lines: [
        {
          line_id: LINE_TOTAL_PROBE_LINE_ID,
          taxable_amount: 90.08,
          tax_amount: 18.92,
          net_amount: 90.08,
          gross_amount: 109,
          taxes: [
            {
              tax_code: "NL-VAT-STD-21",
              direction: "output",
              application_method: "percentage_of_base",
              taxable_base: 90.08,
              rate_value: 0.21,
              tax_amount: 18.92,
              net_amount: 90.08,
              gross_amount: 109,
            },
          ],
        },
      ],
    },
    error: null,
  };
}

function probeInput(overrides?: {
  taxCategory?: string;
  purchasedAt?: string;
}) {
  return {
    purchasedAt: overrides?.purchasedAt ?? "2026-08-21",
    taxCountry: "NL",
    supplierCountry: "NL",
    supplierId: "supplier-1",
    supplierName: "Dairy Co",
    quantity: 10,
    lineTotal: 109,
    taxCategory: overrides?.taxCategory ?? "goods",
    taxRegime: "standard_vat",
  };
}

function draftAfterProbe(unitCost: string): FormDraft {
  return {
    supplier_id: "supplier-1",
    invoice_number: "",
    purchased_at: "2026-08-21",
    notes: "",
    supplier_country: "NL",
    tax_country: "NL",
    lines: [
      {
        ingredient_id: "ingredient-1",
        quantity: "10",
        unit_cost: unitCost,
        line_total: "109.00",
        last_edited_field: "line_total",
        discount: "0",
        tax_category: "goods",
        tax_regime: "standard_vat",
        price_mode: "exclusive",
      },
    ],
  };
}

describe("deriveExclusiveUnitCostFromLineTotal", () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
  });

  it("probes calculate_purchase_taxes as inclusive and leaves draft exclusive net", async () => {
    supabaseMock.rpc.mockResolvedValue(rpcInclusive109At21Percent());

    const result = await deriveExclusiveUnitCostFromLineTotal(probeInput());

    expect(result.error).toBeNull();
    expect(result.data?.netAmount).toBe(90.08);
    expect(result.data?.unitCost).toBe(9.008);

    expect(supabaseMock.rpc).toHaveBeenCalledWith("calculate_purchase_taxes", {
      p_country: "NL",
      p_transaction_date: "2026-08-21",
      p_currency: "EUR",
      p_lines: [
        {
          line_id: LINE_TOTAL_PROBE_LINE_ID,
          quantity: 10,
          unit_price: 10.9,
          discount: 0,
          price_mode: "inclusive",
          tax_category: "goods",
          tax_regime: "standard_vat",
          tax_codes: undefined,
        },
      ],
    });

    const saved = draftToValues(draftAfterProbe(String(result.data?.unitCost)));
    console.log("=== SCENARIO A MOCKED RPC CALL ===");
    console.log(JSON.stringify(supabaseMock.rpc.mock.calls[0], null, 2));
    console.log("=== SCENARIO A MOCKED RPC BODY ===");
    console.log(JSON.stringify(rpcInclusive109At21Percent().data.lines[0], null, 2));
    console.log("=== draftToValues AFTER PROBE ===");
    console.log(JSON.stringify(saved.lines[0], null, 2));

    expect(saved.lines[0]?.price_mode).toBe("exclusive");
    expect(saved.lines[0]?.unit_cost).toBe(9.008);
    expect(saved.lines[0]?.quantity).toBe(10);
  });

  it("does not call RPC and does not invent a unit cost without tax_category", async () => {
    const result = await deriveExclusiveUnitCostFromLineTotal(
      probeInput({ taxCategory: "" }),
    );

    expect(supabaseMock.rpc).not.toHaveBeenCalled();
    expect(result.data).toBeNull();
    expect(result.error).toBe(LINE_TOTAL_UNIT_PRICE_ERROR);
  });

  it("treats empty taxes[] / no-rule warning as an error, not 0% VAT", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: {
        currency: "EUR",
        subtotal: 109,
        tax_total: 0,
        grand_total: 109,
        effective_tax_rate: 0,
        is_valid: true,
        lines: [
          {
            line_id: LINE_TOTAL_PROBE_LINE_ID,
            taxable_amount: 109,
            tax_amount: 0,
            net_amount: 109,
            gross_amount: 109,
            taxes: [],
          },
        ],
      },
      error: null,
    });

    const result = await deriveExclusiveUnitCostFromLineTotal(probeInput());

    expect(result.data).toBeNull();
    expect(result.error).toBe(LINE_TOTAL_UNIT_PRICE_ERROR);
    expect(result.data?.unitCost).toBeUndefined();
  });

  it("does not write a unit cost when the RPC fails", async () => {
    supabaseMock.rpc.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });

    const result = await deriveExclusiveUnitCostFromLineTotal(probeInput());

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
