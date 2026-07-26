/**
 * Purchase Tax Service coverage (DEV-099).
 *
 * Purchases → Tax Integration only (never Tax Engine directly).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTaxRoundingStrategy } from "@/features/tax-engine";
import { taxCountryPackRegistry } from "@/features/tax-integration";
import type { TaxCountryPackAdapter } from "@/features/tax-integration";
import type { TaxCalculationContext } from "@/types/tax-engine";
import { ok } from "@/types/service";
import type { PurchaseTaxDocument } from "../types/purchase-tax";
import { purchaseTaxService } from "./purchase-tax-service";

const { calculateSpy, previewSpy, validateSpy } = vi.hoisted(() => ({
  calculateSpy: vi.fn(),
  previewSpy: vi.fn(),
  validateSpy: vi.fn(),
}));

vi.mock("@/features/tax-integration", async () => {
  const actual = await vi.importActual<
    typeof import("@/features/tax-integration")
  >("@/features/tax-integration");
  return {
    ...actual,
    taxIntegrationService: {
      ...actual.taxIntegrationService,
      calculateTaxes: (
        ...args: Parameters<typeof actual.taxIntegrationService.calculateTaxes>
      ) => {
        calculateSpy(...args);
        return actual.taxIntegrationService.calculateTaxes(...args);
      },
      previewTaxes: (
        ...args: Parameters<typeof actual.taxIntegrationService.previewTaxes>
      ) => {
        previewSpy(...args);
        return actual.taxIntegrationService.previewTaxes(...args);
      },
      validateTaxes: (
        ...args: Parameters<typeof actual.taxIntegrationService.validateTaxes>
      ) => {
        validateSpy(...args);
        return actual.taxIntegrationService.validateTaxes(...args);
      },
    },
  };
});

function document(
  overrides?: Partial<PurchaseTaxDocument>,
): PurchaseTaxDocument {
  return {
    document_id: "purchase-1",
    company: { company_id: "company-1" },
    country: "NL",
    transaction_date: "2026-07-26",
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

function mockMultiTaxAdapter(): TaxCountryPackAdapter {
  const context: TaxCalculationContext = {
    occurred_at: "2026-07-26",
    currency: "EUR",
    jurisdiction_id: "jur-test",
    rounding: createTaxRoundingStrategy("half_up", 2),
    definitions: [
      {
        id: "def-a",
        tax_code: "TX-A",
        category_id: "cat-goods",
        type_id: "type-pct",
        jurisdiction_id: "jur-test",
        name: "A",
        direction: "output",
        is_active: true,
        effective_from: "2020-01-01",
        effective_to: null,
        created_at: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "def-b",
        tax_code: "TX-B",
        category_id: "cat-goods",
        type_id: "type-pct",
        jurisdiction_id: "jur-test",
        name: "B",
        direction: "output",
        is_active: true,
        effective_from: "2020-01-01",
        effective_to: null,
        created_at: "2020-01-01T00:00:00.000Z",
      },
    ],
    types: [
      {
        id: "type-pct",
        code: "PERCENTAGE",
        name: "Percentage",
        application_method: "percentage_of_base",
        is_active: true,
        created_at: "2020-01-01T00:00:00.000Z",
      },
    ],
    rates: [
      {
        id: "rate-a",
        tax_definition_id: "def-a",
        rate_value: 0.1,
        effective_from: "2020-01-01",
        effective_to: null,
        is_active: true,
        created_at: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "rate-b",
        tax_definition_id: "def-b",
        rate_value: 0.05,
        effective_from: "2020-01-01",
        effective_to: null,
        is_active: true,
        created_at: "2020-01-01T00:00:00.000Z",
      },
    ],
    rules: [
      {
        id: "rule-a",
        tax_definition_id: "def-a",
        priority: 100,
        effective_from: "2020-01-01",
        effective_to: null,
        is_active: true,
        jurisdiction_id: "jur-test",
        match: { category: "goods" },
        description: null,
        created_at: "2020-01-01T00:00:00.000Z",
      },
      {
        id: "rule-b",
        tax_definition_id: "def-b",
        priority: 90,
        effective_from: "2020-01-01",
        effective_to: null,
        is_active: true,
        jurisdiction_id: "jur-test",
        match: { category: "goods" },
        description: null,
        created_at: "2020-01-01T00:00:00.000Z",
      },
    ],
    categories: [
      {
        id: "cat-goods",
        code: "goods",
        name: "Goods",
        is_active: true,
        created_at: "2020-01-01T00:00:00.000Z",
      },
    ],
    jurisdictions: [
      {
        id: "jur-test",
        code: "XX",
        name: "Test",
        parent_jurisdiction_id: null,
        is_active: true,
        created_at: "2020-01-01T00:00:00.000Z",
      },
    ],
  };

  return {
    country_codes: ["XX"],
    pack_id: "test-multi",
    default_jurisdiction_id: "jur-test",
    category_codes: ["goods"],
    buildContext: () => ok(context),
  };
}

describe("purchaseTaxService (DEV-099)", () => {
  beforeEach(() => {
    calculateSpy.mockClear();
    previewSpy.mockClear();
    validateSpy.mockClear();
    taxCountryPackRegistry.clear();
  });

  it("calculates a single-line purchase at 21%", () => {
    const result = purchaseTaxService.calculatePurchaseTaxes(document());

    expect(result.error).toBeNull();
    expect(calculateSpy).toHaveBeenCalledTimes(1);
    expect(result.data?.tax_total).toBe(21);
    expect(result.data?.grand_total).toBe(121);
    expect(result.data?.lines[0]?.tax_code).toBe("NL-VAT-STD-21");
    expect(result.data?.lines[0]?.tax_rate_percent).toBe(21);
  });

  it("calculates multiple purchase lines", () => {
    const result = purchaseTaxService.calculatePurchaseTaxes(
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
            tax_regime: "reduced_vat",
          },
        ],
      }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.lines).toHaveLength(2);
    expect(result.data?.tax_total).toBe(30);
  });

  it("supports 9% reduced VAT", () => {
    const result = purchaseTaxService.calculatePurchaseTaxes(
      document({
        lines: [
          {
            line_id: "line-1",
            quantity: 1,
            unit_price: 100,
            tax_category: "food",
            tax_regime: "reduced_vat",
          },
        ],
      }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.tax_total).toBe(9);
    expect(result.data?.lines[0]?.tax_rate_percent).toBe(9);
  });

  it("supports 0% zero-rate VAT", () => {
    const result = purchaseTaxService.calculatePurchaseTaxes(
      document({
        lines: [
          {
            line_id: "line-1",
            quantity: 1,
            unit_price: 100,
            tax_category: "goods",
            tax_regime: "zero_rate",
          },
        ],
      }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.tax_total).toBe(0);
  });

  it("supports reverse charge at 0%", () => {
    const result = purchaseTaxService.calculatePurchaseTaxes(
      document({
        lines: [
          {
            line_id: "line-1",
            quantity: 1,
            unit_price: 250,
            tax_category: "services",
            tax_regime: "reverse_charge",
          },
        ],
      }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.tax_total).toBe(0);
    expect(result.data?.lines[0]?.tax_code).toBe("NL-VAT-RC");
  });

  it("supports preview mode via Tax Integration", () => {
    const result = purchaseTaxService.previewPurchaseTaxes(document());

    expect(result.error).toBeNull();
    expect(previewSpy).toHaveBeenCalledTimes(1);
    expect(result.data?.mode).toBe("preview");
    expect(result.data?.tax_total).toBe(21);
  });

  it("supports validation mode via Tax Integration", () => {
    const result = purchaseTaxService.validatePurchaseTaxes(document());

    expect(result.error).toBeNull();
    expect(validateSpy).toHaveBeenCalledTimes(1);
    expect(result.data?.mode).toBe("validate");
    expect(result.data?.is_valid).toBe(true);
  });

  it("rejects missing supplier country", () => {
    const result = purchaseTaxService.calculatePurchaseTaxes(
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
    expect(calculateSpy).not.toHaveBeenCalled();
  });

  it("rejects missing tax category", () => {
    const result = purchaseTaxService.calculatePurchaseTaxes(
      document({
        lines: [
          {
            line_id: "line-1",
            quantity: 1,
            unit_price: 100,
            tax_category: "",
            tax_regime: "standard_vat",
          },
        ],
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/tax category is required/i);
  });

  it("rejects inactive tax through Tax Integration", () => {
    const inactiveContext: TaxCalculationContext = {
      occurred_at: "2026-07-26",
      currency: "EUR",
      jurisdiction_id: "jur-test",
      rounding: createTaxRoundingStrategy("half_up", 2),
      definitions: [
        {
          id: "def-inactive",
          tax_code: "TX-INACTIVE",
          category_id: "cat-goods",
          type_id: "type-pct",
          jurisdiction_id: "jur-test",
          name: "Inactive",
          direction: "output",
          is_active: false,
          effective_from: "2020-01-01",
          effective_to: null,
          created_at: "2020-01-01T00:00:00.000Z",
        },
      ],
      types: [
        {
          id: "type-pct",
          code: "PERCENTAGE",
          name: "Percentage",
          application_method: "percentage_of_base",
          is_active: true,
          created_at: "2020-01-01T00:00:00.000Z",
        },
      ],
      rates: [
        {
          id: "rate-inactive",
          tax_definition_id: "def-inactive",
          rate_value: 0.1,
          effective_from: "2020-01-01",
          effective_to: null,
          is_active: true,
          created_at: "2020-01-01T00:00:00.000Z",
        },
      ],
      rules: [],
      categories: [
        {
          id: "cat-goods",
          code: "goods",
          name: "Goods",
          is_active: true,
          created_at: "2020-01-01T00:00:00.000Z",
        },
      ],
      jurisdictions: [
        {
          id: "jur-test",
          code: "ZZ",
          name: "Test",
          parent_jurisdiction_id: null,
          is_active: true,
          created_at: "2020-01-01T00:00:00.000Z",
        },
      ],
    };

    taxCountryPackRegistry.register({
      country_codes: ["ZZ"],
      pack_id: "inactive-pack",
      default_jurisdiction_id: "jur-test",
      category_codes: ["goods"],
      buildContext: () => ok(inactiveContext),
    });

    const result = purchaseTaxService.calculatePurchaseTaxes(
      document({
        country: "ZZ",
        lines: [
          {
            line_id: "line-1",
            quantity: 1,
            unit_price: 100,
            tax_category: "goods",
            tax_code: "TX-INACTIVE",
          },
        ],
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/inactive tax definition/i);
  });

  it("selects effective standard rate by transaction date", () => {
    const legacy = purchaseTaxService.calculatePurchaseTaxes(
      document({ transaction_date: "2018-06-01" }),
    );
    const current = purchaseTaxService.calculatePurchaseTaxes(
      document({ transaction_date: "2020-02-01" }),
    );

    expect(legacy.error).toBeNull();
    expect(current.error).toBeNull();
    expect(legacy.data?.tax_total).toBe(19);
    expect(current.data?.tax_total).toBe(21);
  });

  it("supports multi-tax lines through Tax Integration", () => {
    taxCountryPackRegistry.register(mockMultiTaxAdapter());

    const result = purchaseTaxService.calculatePurchaseTaxes(
      document({
        country: "XX",
        lines: [
          {
            line_id: "line-1",
            quantity: 1,
            unit_price: 200,
            tax_category: "goods",
          },
        ],
      }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.tax_result.lines[0]?.taxes).toHaveLength(2);
    expect(result.data?.tax_total).toBe(30);
  });
});
