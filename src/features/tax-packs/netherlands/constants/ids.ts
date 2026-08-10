/**
 * Stable Netherlands Tax Pack identifiers (DEV-097).
 */

export const NL_PACK_ID = "netherlands" as const;
export const NL_PACK_VERSION = "1.0.0";

export const NL_JURISDICTION_ID = "jur-nl";
export const NL_JURISDICTION_CODE = "NL";

export const NL_TYPE_PERCENTAGE_ID = "type-nl-percentage-base";

export const NL_CATEGORY_IDS = {
  goods: "cat-nl-goods",
  services: "cat-nl-services",
  digital_services: "cat-nl-digital-services",
  food: "cat-nl-food",
  alcohol: "cat-nl-alcohol",
  transport: "cat-nl-transport",
} as const;

export const NL_TAX_CODES = {
  standard_vat: "NL-VAT-STD-21",
  reduced_vat: "NL-VAT-RED-9",
  zero_rate: "NL-VAT-ZERO-0",
  exempt: "NL-VAT-EXEMPT",
  reverse_charge: "NL-VAT-RC",
  intra_community_supply: "NL-VAT-ICP",
  import: "NL-VAT-IMPORT",
  export: "NL-VAT-EXPORT",
  small_business_scheme_kor: "NL-VAT-KOR",
} as const;

export const NL_DEFINITION_IDS = {
  standard_vat: "def-nl-standard-vat",
  reduced_vat: "def-nl-reduced-vat",
  zero_rate: "def-nl-zero-rate",
  exempt: "def-nl-exempt",
  reverse_charge: "def-nl-reverse-charge",
  intra_community_supply: "def-nl-icp",
  import: "def-nl-import",
  export: "def-nl-export",
  small_business_scheme_kor: "def-nl-kor",
} as const;

export const NL_RATE_IDS = {
  standard_vat: "rate-nl-standard-21",
  reduced_vat: "rate-nl-reduced-9",
  zero_rate: "rate-nl-zero-0",
  exempt: "rate-nl-exempt-0",
  reverse_charge: "rate-nl-rc-0",
  intra_community_supply: "rate-nl-icp-0",
  import: "rate-nl-import-21",
  export: "rate-nl-export-0",
  small_business_scheme_kor: "rate-nl-kor-0",
} as const;

/** Historical rate used only in effective-date selection tests / pack history. */
export const NL_RATE_STANDARD_LEGACY_ID = "rate-nl-standard-19-legacy";
