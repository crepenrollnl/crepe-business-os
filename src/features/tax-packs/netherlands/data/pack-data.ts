/**
 * Netherlands Tax Pack registered configuration (DEV-097).
 *
 * Data only — no calculation logic.
 */

import type {
  TaxCategory,
  TaxDefinition,
  TaxJurisdiction,
  TaxRate,
  TaxRule,
  TaxType,
} from "@/types/tax-engine";
import {
  NL_CATEGORY_IDS,
  NL_DEFINITION_IDS,
  NL_JURISDICTION_CODE,
  NL_JURISDICTION_ID,
  NL_RATE_IDS,
  NL_RATE_STANDARD_LEGACY_ID,
  NL_TAX_CODES,
  NL_TYPE_PERCENTAGE_ID,
} from "../constants/ids";
import type {
  NetherlandsTaxDefinitionRegistration,
  NetherlandsTaxRegime,
} from "../types/netherlands-tax-pack";

const CREATED_AT = "2020-01-01T00:00:00.000Z";
const EFFECTIVE_FROM = "2019-01-01";
const STANDARD_21_FROM = "2019-01-01";
const STANDARD_LEGACY_TO = "2018-12-31";

export const netherlandsJurisdiction: TaxJurisdiction = {
  id: NL_JURISDICTION_ID,
  code: NL_JURISDICTION_CODE,
  name: "Netherlands",
  parent_jurisdiction_id: null,
  is_active: true,
  created_at: CREATED_AT,
};

export const netherlandsTaxTypes: readonly TaxType[] = [
  {
    id: NL_TYPE_PERCENTAGE_ID,
    code: "NL_PERCENTAGE_OF_BASE",
    name: "Netherlands percentage of taxable base",
    application_method: "percentage_of_base",
    is_active: true,
    created_at: CREATED_AT,
  },
];

export const netherlandsTaxCategories: readonly TaxCategory[] = [
  {
    id: NL_CATEGORY_IDS.goods,
    code: "goods",
    name: "Goods",
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_CATEGORY_IDS.services,
    code: "services",
    name: "Services",
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_CATEGORY_IDS.digital_services,
    code: "digital_services",
    name: "Digital Services",
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_CATEGORY_IDS.food,
    code: "food",
    name: "Food",
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_CATEGORY_IDS.alcohol,
    code: "alcohol",
    name: "Alcohol",
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_CATEGORY_IDS.transport,
    code: "transport",
    name: "Transport",
    is_active: true,
    created_at: CREATED_AT,
  },
];

function def(input: {
  id: string;
  taxCode: string;
  categoryId: string;
  name: string;
  direction?: TaxDefinition["direction"];
  isActive?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}): TaxDefinition {
  return {
    id: input.id,
    tax_code: input.taxCode,
    category_id: input.categoryId,
    type_id: NL_TYPE_PERCENTAGE_ID,
    jurisdiction_id: NL_JURISDICTION_ID,
    name: input.name,
    direction: input.direction ?? "output",
    is_active: input.isActive ?? true,
    effective_from: input.effectiveFrom ?? EFFECTIVE_FROM,
    effective_to: input.effectiveTo ?? null,
    created_at: CREATED_AT,
  };
}

export const netherlandsDefinitionRegistrations: readonly NetherlandsTaxDefinitionRegistration[] =
  [
    {
      regime: "standard_vat",
      definition: def({
        id: NL_DEFINITION_IDS.standard_vat,
        taxCode: NL_TAX_CODES.standard_vat,
        categoryId: NL_CATEGORY_IDS.goods,
        name: "Netherlands Standard VAT",
        // Covers legacy 19% and current 21% rate windows.
        effectiveFrom: "2012-10-01",
      }),
    },
    {
      regime: "reduced_vat",
      definition: def({
        id: NL_DEFINITION_IDS.reduced_vat,
        taxCode: NL_TAX_CODES.reduced_vat,
        categoryId: NL_CATEGORY_IDS.food,
        name: "Netherlands Reduced VAT 9%",
      }),
    },
    {
      regime: "zero_rate",
      definition: def({
        id: NL_DEFINITION_IDS.zero_rate,
        taxCode: NL_TAX_CODES.zero_rate,
        categoryId: NL_CATEGORY_IDS.goods,
        name: "Netherlands Zero Rate VAT",
      }),
    },
    {
      regime: "exempt",
      definition: def({
        id: NL_DEFINITION_IDS.exempt,
        taxCode: NL_TAX_CODES.exempt,
        categoryId: NL_CATEGORY_IDS.services,
        name: "Netherlands VAT Exempt",
      }),
    },
    {
      regime: "reverse_charge",
      definition: def({
        id: NL_DEFINITION_IDS.reverse_charge,
        taxCode: NL_TAX_CODES.reverse_charge,
        categoryId: NL_CATEGORY_IDS.services,
        name: "Netherlands Reverse Charge",
        direction: "neutral",
      }),
    },
    {
      regime: "intra_community_supply",
      definition: def({
        id: NL_DEFINITION_IDS.intra_community_supply,
        taxCode: NL_TAX_CODES.intra_community_supply,
        categoryId: NL_CATEGORY_IDS.goods,
        name: "Netherlands Intra-Community Supply (ICP)",
        direction: "neutral",
      }),
    },
    {
      regime: "import",
      definition: def({
        id: NL_DEFINITION_IDS.import,
        taxCode: NL_TAX_CODES.import,
        categoryId: NL_CATEGORY_IDS.goods,
        name: "Netherlands Import VAT",
        direction: "input",
      }),
    },
    {
      regime: "export",
      definition: def({
        id: NL_DEFINITION_IDS.export,
        taxCode: NL_TAX_CODES.export,
        categoryId: NL_CATEGORY_IDS.goods,
        name: "Netherlands Export (0%)",
        direction: "neutral",
      }),
    },
    {
      regime: "small_business_scheme_kor",
      definition: def({
        id: NL_DEFINITION_IDS.small_business_scheme_kor,
        taxCode: NL_TAX_CODES.small_business_scheme_kor,
        categoryId: NL_CATEGORY_IDS.services,
        name: "Netherlands Small Business Scheme (KOR)",
        direction: "neutral",
      }),
    },
  ];

export const netherlandsTaxRates: readonly TaxRate[] = [
  {
    id: NL_RATE_STANDARD_LEGACY_ID,
    tax_definition_id: NL_DEFINITION_IDS.standard_vat,
    rate_value: 0.19,
    effective_from: "2012-10-01",
    effective_to: STANDARD_LEGACY_TO,
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_RATE_IDS.standard_vat,
    tax_definition_id: NL_DEFINITION_IDS.standard_vat,
    rate_value: 0.21,
    effective_from: STANDARD_21_FROM,
    effective_to: null,
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_RATE_IDS.reduced_vat,
    tax_definition_id: NL_DEFINITION_IDS.reduced_vat,
    rate_value: 0.09,
    effective_from: EFFECTIVE_FROM,
    effective_to: null,
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_RATE_IDS.zero_rate,
    tax_definition_id: NL_DEFINITION_IDS.zero_rate,
    rate_value: 0,
    effective_from: EFFECTIVE_FROM,
    effective_to: null,
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_RATE_IDS.exempt,
    tax_definition_id: NL_DEFINITION_IDS.exempt,
    rate_value: 0,
    effective_from: EFFECTIVE_FROM,
    effective_to: null,
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_RATE_IDS.reverse_charge,
    tax_definition_id: NL_DEFINITION_IDS.reverse_charge,
    rate_value: 0,
    effective_from: EFFECTIVE_FROM,
    effective_to: null,
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_RATE_IDS.intra_community_supply,
    tax_definition_id: NL_DEFINITION_IDS.intra_community_supply,
    rate_value: 0,
    effective_from: EFFECTIVE_FROM,
    effective_to: null,
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_RATE_IDS.import,
    tax_definition_id: NL_DEFINITION_IDS.import,
    rate_value: 0.21,
    effective_from: EFFECTIVE_FROM,
    effective_to: null,
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_RATE_IDS.export,
    tax_definition_id: NL_DEFINITION_IDS.export,
    rate_value: 0,
    effective_from: EFFECTIVE_FROM,
    effective_to: null,
    is_active: true,
    created_at: CREATED_AT,
  },
  {
    id: NL_RATE_IDS.small_business_scheme_kor,
    tax_definition_id: NL_DEFINITION_IDS.small_business_scheme_kor,
    rate_value: 0,
    effective_from: EFFECTIVE_FROM,
    effective_to: null,
    is_active: true,
    created_at: CREATED_AT,
  },
];

function matchRule(input: {
  id: string;
  definitionId: string;
  regime: NetherlandsTaxRegime;
  category: string;
  priority?: number;
  effectiveFrom?: string;
}): TaxRule {
  return {
    id: input.id,
    tax_definition_id: input.definitionId,
    priority: input.priority ?? 100,
    effective_from: input.effectiveFrom ?? EFFECTIVE_FROM,
    effective_to: null,
    is_active: true,
    jurisdiction_id: NL_JURISDICTION_ID,
    match: {
      regime: input.regime,
      category: input.category,
    },
    description: `NL ${input.regime} / ${input.category}`,
    created_at: CREATED_AT,
  };
}

/**
 * Rules select regime (+ category) via opaque match attributes.
 * Tax Engine performs equality matching only.
 */
export const netherlandsTaxRules: readonly TaxRule[] = [
  matchRule({
    id: "rule-nl-standard-goods",
    definitionId: NL_DEFINITION_IDS.standard_vat,
    regime: "standard_vat",
    category: "goods",
    effectiveFrom: "2012-10-01",
  }),
  matchRule({
    id: "rule-nl-standard-services",
    definitionId: NL_DEFINITION_IDS.standard_vat,
    regime: "standard_vat",
    category: "services",
    effectiveFrom: "2012-10-01",
  }),
  matchRule({
    id: "rule-nl-standard-digital",
    definitionId: NL_DEFINITION_IDS.standard_vat,
    regime: "standard_vat",
    category: "digital_services",
    effectiveFrom: "2012-10-01",
  }),
  matchRule({
    id: "rule-nl-standard-alcohol",
    definitionId: NL_DEFINITION_IDS.standard_vat,
    regime: "standard_vat",
    category: "alcohol",
    effectiveFrom: "2012-10-01",
  }),
  matchRule({
    id: "rule-nl-standard-transport",
    definitionId: NL_DEFINITION_IDS.standard_vat,
    regime: "standard_vat",
    category: "transport",
    effectiveFrom: "2012-10-01",
  }),
  matchRule({
    id: "rule-nl-reduced-food",
    definitionId: NL_DEFINITION_IDS.reduced_vat,
    regime: "reduced_vat",
    category: "food",
  }),
  matchRule({
    id: "rule-nl-zero-goods",
    definitionId: NL_DEFINITION_IDS.zero_rate,
    regime: "zero_rate",
    category: "goods",
  }),
  matchRule({
    id: "rule-nl-exempt-services",
    definitionId: NL_DEFINITION_IDS.exempt,
    regime: "exempt",
    category: "services",
  }),
  matchRule({
    id: "rule-nl-reverse-charge-services",
    definitionId: NL_DEFINITION_IDS.reverse_charge,
    regime: "reverse_charge",
    category: "services",
    priority: 200,
  }),
  matchRule({
    id: "rule-nl-icp-goods",
    definitionId: NL_DEFINITION_IDS.intra_community_supply,
    regime: "intra_community_supply",
    category: "goods",
    priority: 200,
  }),
  matchRule({
    id: "rule-nl-import-goods",
    definitionId: NL_DEFINITION_IDS.import,
    regime: "import",
    category: "goods",
    priority: 200,
  }),
  matchRule({
    id: "rule-nl-export-goods",
    definitionId: NL_DEFINITION_IDS.export,
    regime: "export",
    category: "goods",
    priority: 200,
  }),
  matchRule({
    id: "rule-nl-kor-services",
    definitionId: NL_DEFINITION_IDS.small_business_scheme_kor,
    regime: "small_business_scheme_kor",
    category: "services",
    priority: 300,
  }),
  matchRule({
    id: "rule-nl-kor-goods",
    definitionId: NL_DEFINITION_IDS.small_business_scheme_kor,
    regime: "small_business_scheme_kor",
    category: "goods",
    priority: 300,
  }),
];
