/**
 * Purchase Tax Service coverage (DEV-099, V1 plan 1.6).
 *
 * Purchases -> calculate_purchase_taxes RPC only. VAT math itself lives in
 * SQL (sql/072_calculate_purchase_taxes.sql) and is not re-tested here —
 * this file covers RPC parameter construction and response mapping.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PurchaseTaxDocument } from "../types/purchase-tax";

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

import { purchaseTaxService } from "./purchase-tax-service";

function document(
  overrides?: Partial<PurchaseTaxDocument>,
): PurchaseTaxDocument {
  return {
    document_id: "purchase-1",
    company: { company_id: "company-1" },
    country: "nl",
    transaction_date: "2026-07-26T00:00:00.000Z",
    currency: "EUR",
    supplier: {
      supplier_id: "supplier-1",
      name: "Dairy Co",
      country_code: "NL",
    },
    lines: [
      {
        line_id: "line-1",
        quantity: 2,
        unit_price: 50,
        discount: 0,
        tax_category: "goods",
        tax_regime: "standard_vat",
      },
    ],
    ...overrides,
  };
}

function rpcTaxLine(overrides?: Record<string, unknown>) {
  return {
    tax_code: "NL-VAT-STD-21",
    tax_definition_id: "def-std",
    tax_rule_id: "rule-std",
    jurisdiction_id: "jur-nl",
    direction: "output",
    application_method: "percentage_of_base",
    taxable_base: 100,
    rate_value: 0.21,
    tax_amount: 21,
    net_amount: 100,
    gross_amount: 121,
    ...overrides,
  };
}

function rpcResult(overrides?: Record<string, unknown>) {
  return {
    data: {
      country: "NL",
      jurisdiction_id: "jur-nl",
      jurisdiction_code: "NL",
      currency: "EUR",
      transaction_date: "2026-07-26",
      rounding: { mode: "half_up", decimal_places: 2 },
      subtotal: 100,
      tax_total: 21,
      grand_total: 121,
      effective_tax_rate: 0.21,
      lines: [
        {
          line_id: "line-1",
          taxable_amount: 100,
          tax_amount: 21,
          net_amount: 100,
          gross_amount: 121,
          taxes: [rpcTaxLine()],
        },
      ],
      by_tax_code: { "NL-VAT-STD-21": 21 },
      is_valid: true,
      ...overrides,
    },
    error: null,
  };
}

describe("purchaseTaxService (DEV-099, RPC-based)", () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
  });

  describe("RPC parameter construction", () => {
    it("uppercases country, truncates the date, and maps line fields", async () => {
      supabaseMock.rpc.mockResolvedValue(rpcResult());

      const result = await purchaseTaxService.calculatePurchaseTaxes(document());

      expect(result.error).toBeNull();
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("calculate_purchase_taxes", {
        p_country: "NL",
        p_transaction_date: "2026-07-26",
        p_currency: "EUR",
        p_lines: [
          {
            line_id: "line-1",
            quantity: 2,
            unit_price: 50,
            discount: 0,
            price_mode: "exclusive",
            tax_category: "goods",
            tax_regime: "standard_vat",
            tax_codes: undefined,
          },
        ],
      });
    });

    it("forwards inclusive price_mode instead of hardcoding exclusive", async () => {
      supabaseMock.rpc.mockResolvedValue(rpcResult());

      await purchaseTaxService.calculatePurchaseTaxes(
        document({
          lines: [
            {
              line_id: "line-1",
              quantity: 1,
              unit_price: 121,
              tax_category: "goods",
              tax_regime: "standard_vat",
              price_mode: "inclusive",
            },
          ],
        }),
      );

      const [, params] = supabaseMock.rpc.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      const lines = params.p_lines as Array<Record<string, unknown>>;
      expect(lines[0]?.price_mode).toBe("inclusive");
      expect(lines[0]?.unit_price).toBe(121);
    });

    it("defaults discount to 0 and tax_regime to null when omitted", async () => {
      supabaseMock.rpc.mockResolvedValue(rpcResult());

      await purchaseTaxService.calculatePurchaseTaxes(
        document({
          lines: [
            {
              line_id: "line-1",
              quantity: 1,
              unit_price: 100,
              tax_category: "goods",
            },
          ],
        }),
      );

      const [, params] = supabaseMock.rpc.mock.calls[0] as [string, Record<string, unknown>];
      const lines = params.p_lines as Array<Record<string, unknown>>;
      expect(lines[0]).toMatchObject({
        discount: 0,
        tax_regime: null,
        tax_codes: undefined,
      });
    });

    it("wraps an explicit tax_code into a single-element tax_codes array", async () => {
      supabaseMock.rpc.mockResolvedValue(rpcResult());

      await purchaseTaxService.calculatePurchaseTaxes(
        document({
          lines: [
            {
              line_id: "line-1",
              quantity: 1,
              unit_price: 100,
              tax_category: "goods",
              tax_code: "NL-VAT-STD-21",
            },
          ],
        }),
      );

      const [, params] = supabaseMock.rpc.mock.calls[0] as [string, Record<string, unknown>];
      const lines = params.p_lines as Array<Record<string, unknown>>;
      expect(lines[0]?.tax_codes).toEqual(["NL-VAT-STD-21"]);
    });

    it("maps every purchase line into the RPC line array", async () => {
      supabaseMock.rpc.mockResolvedValue(
        rpcResult({
          subtotal: 200,
          tax_total: 30,
          grand_total: 230,
          lines: [
            {
              line_id: "line-1",
              taxable_amount: 100,
              tax_amount: 21,
              net_amount: 100,
              gross_amount: 121,
              taxes: [rpcTaxLine()],
            },
            {
              line_id: "line-2",
              taxable_amount: 100,
              tax_amount: 9,
              net_amount: 100,
              gross_amount: 109,
              taxes: [
                rpcTaxLine({
                  tax_code: "NL-VAT-RED-9",
                  rate_value: 0.09,
                  tax_amount: 9,
                  gross_amount: 109,
                }),
              ],
            },
          ],
        }),
      );

      await purchaseTaxService.calculatePurchaseTaxes(
        document({
          lines: [
            {
              line_id: "line-1",
              quantity: 1,
              unit_price: 100,
              tax_category: "goods",
            },
            {
              line_id: "line-2",
              quantity: 1,
              unit_price: 100,
              tax_category: "food",
              tax_regime: "reduced_vat",
            },
          ],
        }),
      );

      const [, params] = supabaseMock.rpc.mock.calls[0] as [string, Record<string, unknown>];
      expect(params.p_lines).toHaveLength(2);
    });
  });

  describe("response mapping", () => {
    it("maps a successful RPC result into PurchaseTaxResult", async () => {
      supabaseMock.rpc.mockResolvedValue(rpcResult());

      const result = await purchaseTaxService.calculatePurchaseTaxes(document());

      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({
        document_id: "purchase-1",
        mode: "calculate",
        is_valid: true,
        subtotal: 100,
        tax_total: 21,
        grand_total: 121,
        effective_tax_rate: 0.21,
      });
      expect(result.data?.warnings).toEqual([]);
      expect(result.data?.lines).toEqual([
        {
          line_id: "line-1",
          tax_code: "NL-VAT-STD-21",
          tax_rate_percent: 21,
          tax_amount: 21,
          taxable_amount: 100,
          net_amount: 100,
          gross_amount: 121,
        },
      ]);
    });

    it("flattens per-line tax breakdowns into tax_result.breakdown.lines", async () => {
      supabaseMock.rpc.mockResolvedValue(
        rpcResult({
          subtotal: 200,
          tax_total: 30,
          grand_total: 230,
          lines: [
            {
              line_id: "line-1",
              taxable_amount: 100,
              tax_amount: 21,
              net_amount: 100,
              gross_amount: 121,
              taxes: [rpcTaxLine()],
            },
            {
              line_id: "line-2",
              taxable_amount: 100,
              tax_amount: 9,
              net_amount: 100,
              gross_amount: 109,
              taxes: [
                rpcTaxLine({
                  tax_code: "NL-VAT-RED-9",
                  rate_value: 0.09,
                  tax_amount: 9,
                  gross_amount: 109,
                }),
              ],
            },
          ],
        }),
      );

      const result = await purchaseTaxService.calculatePurchaseTaxes(document());

      expect(result.data?.tax_result.currency).toBe("EUR");
      expect(result.data?.tax_result.breakdown.lines).toHaveLength(2);
      expect(
        result.data?.tax_result.breakdown.lines.map((line) => line.tax_code),
      ).toEqual(["NL-VAT-STD-21", "NL-VAT-RED-9"]);
    });

    it("returns null tax_code/tax_rate_percent for a line with no resolved tax", async () => {
      supabaseMock.rpc.mockResolvedValue(
        rpcResult({
          tax_total: 0,
          grand_total: 100,
          effective_tax_rate: 0,
          lines: [
            {
              line_id: "line-1",
              taxable_amount: 100,
              tax_amount: 0,
              net_amount: 100,
              gross_amount: 100,
              taxes: [],
            },
          ],
          by_tax_code: {},
        }),
      );

      const result = await purchaseTaxService.calculatePurchaseTaxes(document());

      expect(result.data?.lines[0]).toMatchObject({
        tax_code: null,
        tax_rate_percent: null,
        tax_amount: 0,
      });
      expect(result.data?.tax_result.breakdown.lines).toHaveLength(0);
      expect(result.data?.warnings).toEqual([
        "No tax rule found for category 'goods' with regime 'standard_vat'. Tax amount set to 0. Please check the tax regime selection.",
      ]);
    });

    it("only warns for the unresolved line when one of several lines has no matching rule", async () => {
      supabaseMock.rpc.mockResolvedValue(
        rpcResult({
          subtotal: 200,
          tax_total: 21,
          grand_total: 221,
          lines: [
            {
              line_id: "line-1",
              taxable_amount: 100,
              tax_amount: 21,
              net_amount: 100,
              gross_amount: 121,
              taxes: [rpcTaxLine()],
            },
            {
              line_id: "line-2",
              taxable_amount: 100,
              tax_amount: 0,
              net_amount: 100,
              gross_amount: 100,
              taxes: [],
            },
          ],
        }),
      );

      const result = await purchaseTaxService.calculatePurchaseTaxes(
        document({
          lines: [
            {
              line_id: "line-1",
              quantity: 1,
              unit_price: 100,
              tax_category: "goods",
              tax_regime: "standard_vat",
            },
            {
              line_id: "line-2",
              quantity: 1,
              unit_price: 100,
              tax_category: "food",
              tax_regime: "standard_vat",
            },
          ],
        }),
      );

      expect(result.data?.warnings).toEqual([
        "No tax rule found for category 'food' with regime 'standard_vat'. Tax amount set to 0. Please check the tax regime selection.",
      ]);
    });

    it("tags mode=preview for previewPurchaseTaxes without changing the call", async () => {
      supabaseMock.rpc.mockResolvedValue(rpcResult());

      const result = await purchaseTaxService.previewPurchaseTaxes(document());

      expect(result.data?.mode).toBe("preview");
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    });

    it("tags mode=validate for validatePurchaseTaxes without changing the call", async () => {
      supabaseMock.rpc.mockResolvedValue(rpcResult());

      const result = await purchaseTaxService.validatePurchaseTaxes(document());

      expect(result.data?.mode).toBe("validate");
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    });
  });

  describe("validation before the RPC call", () => {
    it("rejects missing supplier country without calling the RPC", async () => {
      const result = await purchaseTaxService.calculatePurchaseTaxes(
        document({
          supplier: {
            supplier_id: "supplier-1",
            name: "Dairy Co",
            country_code: null,
          },
        }),
      );

      expect(result.data).toBeNull();
      expect(result.error).toMatch(/supplier country is required/i);
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects missing company/tax country without calling the RPC", async () => {
      const result = await purchaseTaxService.calculatePurchaseTaxes(
        document({ country: "" }),
      );

      expect(result.data).toBeNull();
      expect(result.error).toMatch(/tax country is required/i);
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects an empty lines array without calling the RPC", async () => {
      const result = await purchaseTaxService.calculatePurchaseTaxes(
        document({ lines: [] }),
      );

      expect(result.data).toBeNull();
      expect(result.error).toMatch(/at least one line/i);
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects missing tax category without calling the RPC", async () => {
      const result = await purchaseTaxService.calculatePurchaseTaxes(
        document({
          lines: [
            {
              line_id: "line-1",
              quantity: 1,
              unit_price: 100,
              tax_category: "",
            },
          ],
        }),
      );

      expect(result.data).toBeNull();
      expect(result.error).toMatch(/tax category is required/i);
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });
  });

  describe("RPC error handling", () => {
    it("surfaces an RPC error as a failed ServiceResult", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "No active tax jurisdiction is registered for country 'ZZ'.",
        },
      });

      const result = await purchaseTaxService.calculatePurchaseTaxes(
        document({ country: "ZZ" }),
      );

      expect(result.data).toBeNull();
      expect(result.error).toMatch(/no active tax jurisdiction/i);
    });
  });
});
