/**
 * Tax Engine foundation coverage (DEV-096).
 *
 * Country-agnostic pipeline only — no Localization Pack behaviour.
 */

import { describe, expect, it } from "vitest";
import type {
  TaxCalculationContext,
  TaxDefinition,
  TaxRate,
  TaxRequest,
  TaxRule,
  TaxType,
} from "@/types/tax-engine";
import { taxEngineService } from "./tax-engine-service";
import { createTaxRoundingStrategy } from "../utils/tax-rounding";

function taxType(overrides?: Partial<TaxType>): TaxType {
  return {
    id: "type-pct",
    code: "TYPE_PERCENTAGE_BASE",
    name: "Percentage of taxable base",
    application_method: "percentage_of_base",
    is_active: true,
    created_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function definition(overrides?: Partial<TaxDefinition>): TaxDefinition {
  return {
    id: "def-a",
    tax_code: "TX-A",
    category_id: "cat-1",
    type_id: "type-pct",
    jurisdiction_id: "jur-1",
    name: "Standard component A",
    direction: "output",
    is_active: true,
    effective_from: "2020-01-01",
    effective_to: null,
    created_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function rate(overrides?: Partial<TaxRate>): TaxRate {
  return {
    id: "rate-a",
    tax_definition_id: "def-a",
    rate_value: 0.1,
    effective_from: "2020-01-01",
    effective_to: null,
    is_active: true,
    created_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function rule(overrides?: Partial<TaxRule>): TaxRule {
  return {
    id: "rule-a",
    tax_definition_id: "def-a",
    priority: 100,
    effective_from: "2020-01-01",
    effective_to: null,
    is_active: true,
    jurisdiction_id: "jur-1",
    match: {},
    description: "Default match",
    created_at: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function context(
  overrides?: Partial<TaxCalculationContext>,
): TaxCalculationContext {
  return {
    occurred_at: "2026-07-26T10:00:00.000Z",
    currency: "EUR",
    jurisdiction_id: "jur-1",
    rounding: createTaxRoundingStrategy("half_up", 2),
    definitions: [definition()],
    types: [taxType()],
    rates: [rate()],
    rules: [rule()],
    ...overrides,
  };
}

function request(overrides?: Partial<TaxRequest>): TaxRequest {
  return {
    request_id: "req-1",
    lines: [
      {
        line_id: "line-1",
        amount: 100,
        quantity: 1,
        currency: "EUR",
        price_mode: "exclusive",
        tax_codes: ["TX-A"],
      },
    ],
    context: context(),
    ...overrides,
  };
}

describe("taxEngineService (DEV-096)", () => {
  it("runs the generic calculation pipeline for a single tax", () => {
    const result = taxEngineService.calculate(request());

    expect(result.error).toBeNull();
    expect(result.data?.net_total).toBe(100);
    expect(result.data?.tax_total).toBe(10);
    expect(result.data?.gross_total).toBe(110);
    expect(result.data?.breakdown.lines).toHaveLength(1);
    expect(result.data?.breakdown.by_tax_code["TX-A"]).toBe(10);
  });

  it("supports multiple tax definitions on one line", () => {
    const result = taxEngineService.calculate(
      request({
        lines: [
          {
            line_id: "line-1",
            amount: 200,
            quantity: 1,
            currency: "EUR",
            price_mode: "exclusive",
            tax_codes: ["TX-A", "TX-B"],
          },
        ],
        context: context({
          definitions: [
            definition({ id: "def-a", tax_code: "TX-A" }),
            definition({
              id: "def-b",
              tax_code: "TX-B",
              name: "Secondary component B",
            }),
          ],
          rates: [
            rate({ id: "rate-a", tax_definition_id: "def-a", rate_value: 0.1 }),
            rate({ id: "rate-b", tax_definition_id: "def-b", rate_value: 0.05 }),
          ],
          rules: [
            rule({ id: "rule-a", tax_definition_id: "def-a" }),
            rule({
              id: "rule-b",
              tax_definition_id: "def-b",
              priority: 90,
            }),
          ],
        }),
      }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.breakdown.lines).toHaveLength(2);
    expect(result.data?.tax_total).toBe(30);
    expect(result.data?.gross_total).toBe(230);
    expect(result.data?.breakdown.by_tax_code["TX-A"]).toBe(20);
    expect(result.data?.breakdown.by_tax_code["TX-B"]).toBe(10);
  });

  it("applies rounding strategy abstraction (half_up vs floor)", () => {
    const halfUp = taxEngineService.calculate(
      request({
        lines: [
          {
            line_id: "line-1",
            amount: 10.005,
            quantity: 1,
            currency: "EUR",
            price_mode: "exclusive",
            tax_codes: ["TX-A"],
          },
        ],
        context: context({
          rounding: createTaxRoundingStrategy("half_up", 2),
          rates: [rate({ rate_value: 0.1 })],
        }),
      }),
    );

    const floored = taxEngineService.calculate(
      request({
        lines: [
          {
            line_id: "line-1",
            amount: 10.005,
            quantity: 1,
            currency: "EUR",
            price_mode: "exclusive",
            tax_codes: ["TX-A"],
          },
        ],
        context: context({
          rounding: createTaxRoundingStrategy("floor", 2),
          rates: [rate({ rate_value: 0.1 })],
        }),
      }),
    );

    expect(halfUp.error).toBeNull();
    expect(floored.error).toBeNull();
    expect(halfUp.data?.tax_total).toBe(1);
    expect(floored.data?.tax_total).toBe(1);
    // Base rounding differs by strategy on the net amount path.
    expect(halfUp.data?.net_total).toBe(10.01);
    expect(floored.data?.net_total).toBe(10);
  });

  it("detects missing tax rules for a requested tax code", () => {
    const result = taxEngineService.calculate(
      request({
        lines: [
          {
            line_id: "line-1",
            amount: 100,
            quantity: 1,
            currency: "EUR",
            price_mode: "exclusive",
            tax_codes: ["TX-MISSING"],
          },
        ],
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/no active tax rule matched/i);
  });

  it("rejects duplicate tax codes among active definitions", () => {
    const result = taxEngineService.calculate(
      request({
        context: context({
          definitions: [
            definition({ id: "def-a", tax_code: "TX-A" }),
            definition({ id: "def-dup", tax_code: "TX-A" }),
          ],
        }),
      }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/duplicate tax_code/i);
  });

  it("validateDefinitions reports duplicate tax codes without calculating", () => {
    const result = taxEngineService.validateDefinitions(
      [
        definition({ id: "def-a", tax_code: "TX-A" }),
        definition({ id: "def-b", tax_code: "TX-A" }),
      ],
      "2026-07-26",
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/duplicate tax_code/i);
  });

  it("resolves inclusive price mode through the pipeline", () => {
    const result = taxEngineService.calculate(
      request({
        lines: [
          {
            line_id: "line-1",
            amount: 110,
            quantity: 1,
            currency: "EUR",
            price_mode: "inclusive",
            tax_codes: ["TX-A"],
          },
        ],
      }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.gross_total).toBe(110);
    expect(result.data?.net_total).toBe(100);
    expect(result.data?.tax_total).toBe(10);
  });

  it("uses amount_per_quantity application method without regime knowledge", () => {
    const result = taxEngineService.calculate(
      request({
        lines: [
          {
            line_id: "line-1",
            amount: 50,
            quantity: 3,
            currency: "EUR",
            price_mode: "exclusive",
            tax_codes: ["TX-Q"],
          },
        ],
        context: context({
          definitions: [
            definition({
              id: "def-q",
              tax_code: "TX-Q",
              type_id: "type-qty",
            }),
          ],
          types: [
            taxType({
              id: "type-qty",
              code: "TYPE_PER_QUANTITY",
              application_method: "amount_per_quantity",
            }),
          ],
          rates: [
            rate({
              id: "rate-q",
              tax_definition_id: "def-q",
              rate_value: 2.5,
            }),
          ],
          rules: [rule({ id: "rule-q", tax_definition_id: "def-q" })],
        }),
      }),
    );

    expect(result.error).toBeNull();
    expect(result.data?.tax_total).toBe(7.5);
    expect(result.data?.gross_total).toBe(57.5);
  });
});
