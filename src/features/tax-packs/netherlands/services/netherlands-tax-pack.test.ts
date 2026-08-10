/**
 * Netherlands Tax Pack coverage (DEV-097).
 *
 * Configuration pack + Tax Engine calculation (no pack-side math).
 */

import { describe, expect, it } from "vitest";
import { taxEngineService } from "@/features/tax-engine";
import {
  NL_DEFINITION_IDS,
  NL_TAX_CODES,
} from "../constants/ids";
import {
  netherlandsDefinitionRegistrations,
  netherlandsTaxRates,
  netherlandsTaxRules,
} from "../data/pack-data";
import type { NetherlandsTaxPack } from "../types/netherlands-tax-pack";
import { NETHERLANDS_TAX_REGIMES } from "../types/netherlands-tax-pack";
import { netherlandsTaxPackService } from "./netherlands-tax-pack";

function calculateRegime(input: {
  regime: string;
  category: string;
  amount: number;
  occurredAt?: string;
  taxCode?: string;
}) {
  const contextResult = netherlandsTaxPackService.buildTaxContext({
    occurredAt: input.occurredAt ?? "2026-07-26T10:00:00.000Z",
  });
  expect(contextResult.error).toBeNull();

  return taxEngineService.calculate({
    request_id: `nl-${input.regime}`,
    lines: [
      {
        line_id: "line-1",
        amount: input.amount,
        quantity: 1,
        currency: "EUR",
        price_mode: "exclusive",
        ...(input.taxCode ? { tax_codes: [input.taxCode] } : {}),
        attributes: {
          regime: input.regime,
          category: input.category,
        },
      },
    ],
    context: contextResult.data!,
  });
}

function clonePack(): NetherlandsTaxPack {
  const packResult = netherlandsTaxPackService.getPack();
  expect(packResult.error).toBeNull();
  return structuredClone(packResult.data!);
}

describe("netherlandsTaxPackService (DEV-097)", () => {
  it("registers all required Netherlands regimes", () => {
    const pack = netherlandsTaxPackService.getPack();
    expect(pack.error).toBeNull();
    expect(pack.data?.regimes).toEqual([...NETHERLANDS_TAX_REGIMES]);
    expect(pack.data?.jurisdiction.name).toBe("Netherlands");
    expect(pack.data?.categories.map((row) => row.code)).toEqual(
      expect.arrayContaining([
        "goods",
        "services",
        "digital_services",
        "food",
        "alcohol",
        "transport",
      ]),
    );
  });

  it("calculates 21% standard VAT through Tax Engine", () => {
    const result = calculateRegime({
      regime: "standard_vat",
      category: "goods",
      amount: 100,
      taxCode: NL_TAX_CODES.standard_vat,
    });

    expect(result.error).toBeNull();
    expect(result.data?.tax_total).toBe(21);
    expect(result.data?.gross_total).toBe(121);
    expect(result.data?.breakdown.by_tax_code[NL_TAX_CODES.standard_vat]).toBe(
      21,
    );
  });

  it("calculates 9% reduced VAT through Tax Engine", () => {
    const result = calculateRegime({
      regime: "reduced_vat",
      category: "food",
      amount: 100,
      taxCode: NL_TAX_CODES.reduced_vat,
    });

    expect(result.error).toBeNull();
    expect(result.data?.tax_total).toBe(9);
    expect(result.data?.gross_total).toBe(109);
  });

  it("calculates 0% zero-rate VAT through Tax Engine", () => {
    const result = calculateRegime({
      regime: "zero_rate",
      category: "goods",
      amount: 100,
      taxCode: NL_TAX_CODES.zero_rate,
    });

    expect(result.error).toBeNull();
    expect(result.data?.tax_total).toBe(0);
    expect(result.data?.gross_total).toBe(100);
  });

  it("applies reverse charge at 0% via rule resolution", () => {
    const result = calculateRegime({
      regime: "reverse_charge",
      category: "services",
      amount: 250,
      taxCode: NL_TAX_CODES.reverse_charge,
    });

    expect(result.error).toBeNull();
    expect(result.data?.tax_total).toBe(0);
    expect(result.data?.breakdown.lines[0]?.tax_definition_id).toBe(
      NL_DEFINITION_IDS.reverse_charge,
    );
  });

  it("applies ICP (intra-community supply) at 0%", () => {
    const result = calculateRegime({
      regime: "intra_community_supply",
      category: "goods",
      amount: 400,
      taxCode: NL_TAX_CODES.intra_community_supply,
    });

    expect(result.error).toBeNull();
    expect(result.data?.tax_total).toBe(0);
    expect(result.data?.breakdown.lines[0]?.tax_code).toBe(
      NL_TAX_CODES.intra_community_supply,
    );
  });

  it("applies export at 0%", () => {
    const result = calculateRegime({
      regime: "export",
      category: "goods",
      amount: 180,
      taxCode: NL_TAX_CODES.export,
    });

    expect(result.error).toBeNull();
    expect(result.data?.tax_total).toBe(0);
    expect(result.data?.gross_total).toBe(180);
  });

  it("applies KOR (small business scheme) at 0%", () => {
    const result = calculateRegime({
      regime: "small_business_scheme_kor",
      category: "services",
      amount: 90,
      taxCode: NL_TAX_CODES.small_business_scheme_kor,
    });

    expect(result.error).toBeNull();
    expect(result.data?.tax_total).toBe(0);
    expect(result.data?.breakdown.lines[0]?.tax_definition_id).toBe(
      NL_DEFINITION_IDS.small_business_scheme_kor,
    );
  });

  it("resolves rules by regime + category attributes", () => {
    const result = calculateRegime({
      regime: "standard_vat",
      category: "digital_services",
      amount: 50,
    });

    expect(result.error).toBeNull();
    expect(result.data?.breakdown.lines).toHaveLength(1);
    expect(result.data?.breakdown.lines[0]?.tax_code).toBe(
      NL_TAX_CODES.standard_vat,
    );
    expect(result.data?.tax_total).toBe(10.5);
  });

  it("selects the effective standard VAT rate by date (19% legacy vs 21%)", () => {
    const legacy = calculateRegime({
      regime: "standard_vat",
      category: "goods",
      amount: 100,
      occurredAt: "2018-06-01",
      taxCode: NL_TAX_CODES.standard_vat,
    });
    const current = calculateRegime({
      regime: "standard_vat",
      category: "goods",
      amount: 100,
      occurredAt: "2020-01-15",
      taxCode: NL_TAX_CODES.standard_vat,
    });

    expect(legacy.error).toBeNull();
    expect(current.error).toBeNull();
    expect(legacy.data?.tax_total).toBe(19);
    expect(current.data?.tax_total).toBe(21);
  });

  it("rejects duplicate tax codes in pack validation", () => {
    const pack = clonePack();
    pack.definitions = [
      ...pack.definitions,
      {
        regime: "zero_rate",
        definition: {
          ...pack.definitions[0]!.definition,
          id: "def-duplicate",
          tax_code: NL_TAX_CODES.standard_vat,
        },
      },
    ];

    const result = netherlandsTaxPackService.validatePack(pack);
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/duplicate tax_code/i);
  });

  it("rejects invalid regimes in pack validation", () => {
    const pack = clonePack();
    pack.definitions = [
      ...pack.definitions,
      {
        regime: "not_a_real_regime" as never,
        definition: {
          ...pack.definitions[0]!.definition,
          id: "def-bad-regime",
          tax_code: "NL-VAT-BAD",
        },
      },
    ];

    const result = netherlandsTaxPackService.validatePack(pack);
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/invalid regime/i);
  });

  it("rejects inactive tax definitions that still have active rules", () => {
    const pack = clonePack();
    pack.definitions = pack.definitions.map((row) =>
      row.definition.id === NL_DEFINITION_IDS.standard_vat
        ? {
            ...row,
            definition: { ...row.definition, is_active: false },
          }
        : row,
    );

    const result = netherlandsTaxPackService.validatePack(pack);
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/inactive tax definition/i);
  });

  it("rejects invalid effective dates on rates", () => {
    const pack = clonePack();
    pack.rates = pack.rates.map((rate) =>
      rate.id === "rate-nl-reduced-9"
        ? {
            ...rate,
            effective_from: "2026-01-01",
            effective_to: "2025-01-01",
          }
        : rate,
    );

    const result = netherlandsTaxPackService.validatePack(pack);
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/effective_from must be on or before/i);
  });

  it("rejects overlapping rules with same match, jurisdiction, and priority", () => {
    const pack = clonePack();
    const base = pack.rules.find(
      (rule) => rule.id === "rule-nl-standard-goods",
    )!;
    pack.rules = [
      ...pack.rules,
      {
        ...base,
        id: "rule-nl-standard-goods-overlap",
        tax_definition_id: NL_DEFINITION_IDS.zero_rate,
      },
    ];

    const result = netherlandsTaxPackService.validatePack(pack);
    expect(result.data).toBeNull();
    expect(result.error).toMatch(/overlapping tax rules/i);
  });

  it("exposes definition registrations and rates without calculation helpers", () => {
    expect(netherlandsDefinitionRegistrations).toHaveLength(9);
    expect(netherlandsTaxRates.some((rate) => rate.rate_value === 0.21)).toBe(
      true,
    );
    expect(netherlandsTaxRates.some((rate) => rate.rate_value === 0.09)).toBe(
      true,
    );
    expect(netherlandsTaxRules.length).toBeGreaterThanOrEqual(9);
    expect(netherlandsTaxPackService.listRegimes()).toContain("reverse_charge");
    expect(netherlandsTaxPackService.listRegimes()).toContain(
      "small_business_scheme_kor",
    );
  });
});
