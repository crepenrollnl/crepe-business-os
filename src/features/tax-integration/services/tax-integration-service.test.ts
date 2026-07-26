/**
 * Tax Integration Framework coverage (DEV-098).
 *
 * Operational entrypoint → Tax Engine → Country Pack.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createTaxRoundingStrategy } from "@/features/tax-engine";
import type { TaxCalculationContext } from "@/types/tax-engine";
import { ok } from "@/types/service";
import type { TaxCountryPackAdapter } from "../registry/country-pack-registry";
import { taxCountryPackRegistry } from "../registry/country-pack-registry";
import type { TaxRequest } from "../types/tax-integration";
import { taxIntegrationService } from "./tax-integration-service";

function baseRequest(overrides?: Partial<TaxRequest>): TaxRequest {
  return {
    request_id: "tax-req-1",
    company: { company_id: "company-1" },
    country: "NL",
    document_type: "sale",
    transaction_date: "2026-07-26",
    currency: "EUR",
    customer: {
      party_type: "customer",
      party_id: "customer-1",
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
        tax_code: "NL-VAT-STD-21",
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
        name: "Component A",
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
        name: "Component B",
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

function mockInactiveTaxAdapter(): TaxCountryPackAdapter {
  const context: TaxCalculationContext = {
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
        code: "XX",
        name: "Test",
        parent_jurisdiction_id: null,
        is_active: true,
        created_at: "2020-01-01T00:00:00.000Z",
      },
    ],
  };

  return {
    country_codes: ["ZZ"],
    pack_id: "test-inactive",
    default_jurisdiction_id: "jur-test",
    category_codes: ["goods"],
    buildContext: () => ok(context),
  };
}

describe("taxIntegrationService (DEV-098)", () => {
  beforeEach(() => {
    taxCountryPackRegistry.clear();
    taxIntegrationService.ensureRegisteredPacks();
  });

  it("calculates single-line tax through the integration framework", () => {
    const result = taxIntegrationService.calculateTaxes(baseRequest());

    expect(result.error).toBeNull();
    expect(result.data?.mode).toBe("calculate");
    expect(result.data?.tax_total).toBe(21);
    expect(result.data?.net_total).toBe(100);
    expect(result.data?.gross_total).toBe(121);
    expect(result.data?.effective_tax_rate).toBe(0.21);
    expect(result.data?.lines).toHaveLength(1);
    expect(result.data?.applied_tax_definitions[0]?.tax_code).toBe(
      "NL-VAT-STD-21",
    );
    expect(result.data?.rounding.mode).toBe("half_up");
  });

  it("calculates a multi-line document", () => {
    const result = taxIntegrationService.calculateTaxes(
      baseRequest({
        lines: [
          {
            line_id: "line-1",
            quantity: 1,
            unit_price: 100,
            tax_category: "goods",
            tax_regime: "standard_vat",
            tax_code: "NL-VAT-STD-21",
          },
          {
            line_id: "line-2",
            quantity: 1,
            unit_price: 100,
            tax_category: "food",
            tax_regime: "reduced_vat",
            tax_code: "NL-VAT-RED-9",
          },
        ],
      }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.lines).toHaveLength(2);
    expect(result.data?.tax_total).toBe(30);
    expect(result.data?.gross_total).toBe(230);
  });

  it("supports multiple taxes on one line via Country Pack rules", () => {
    taxCountryPackRegistry.register(mockMultiTaxAdapter());

    const result = taxIntegrationService.calculateTaxes(
      baseRequest({
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
    expect(result.data?.lines[0]?.taxes).toHaveLength(2);
    expect(result.data?.tax_total).toBe(30);
    expect(result.data?.warnings.some((w) => w.code === "MULTIPLE_TAXES_ON_LINE")).toBe(
      true,
    );
  });

  it("rejects invalid tax requests", () => {
    const result = taxIntegrationService.calculateTaxes(
      baseRequest({
        request_id: "",
        currency: "",
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/request_id is required/i);
  });

  it("rejects inactive taxes", () => {
    taxCountryPackRegistry.register(mockInactiveTaxAdapter());

    const result = taxIntegrationService.calculateTaxes(
      baseRequest({
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

  it("rejects missing tax category", () => {
    const result = taxIntegrationService.calculateTaxes(
      baseRequest({
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
  });

  it("rejects unknown tax category for the Country Pack", () => {
    const result = taxIntegrationService.calculateTaxes(
      baseRequest({
        lines: [
          {
            line_id: "line-1",
            quantity: 1,
            unit_price: 100,
            tax_category: "not-a-category",
            tax_regime: "standard_vat",
          },
        ],
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/not registered in the country pack/i);
  });

  it("preview mode returns calculated taxes with mode=preview", () => {
    const result = taxIntegrationService.previewTaxes(baseRequest());

    expect(result.error).toBeNull();
    expect(result.data?.mode).toBe("preview");
    expect(result.data?.tax_total).toBe(21);
    expect(result.data?.is_valid).toBe(true);
  });

  it("validation mode accepts a valid request without amounts", () => {
    const result = taxIntegrationService.validateTaxes(baseRequest());

    expect(result.error).toBeNull();
    expect(result.data?.mode).toBe("validate");
    expect(result.data?.is_valid).toBe(true);
    expect(result.data?.tax_total).toBe(0);
    expect(result.data?.breakdown.lines).toHaveLength(0);
  });

  it("validation mode rejects invalid jurisdiction", () => {
    const result = taxIntegrationService.validateTaxes(
      baseRequest({
        jurisdiction: "jur-does-not-exist",
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/jurisdiction/i);
  });
});
