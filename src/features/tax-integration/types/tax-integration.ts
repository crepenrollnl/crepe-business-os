/**
 * Tax Integration Framework contracts (DEV-098).
 *
 * Operational modules request tax calculations only through this layer.
 * They must never import Tax Engine or Country Packs directly.
 */

import type {
  TaxBreakdown,
  TaxBreakdownLine,
  TaxCode,
  TaxDefinition,
  TaxPriceMode,
  TaxRoundingMode,
} from "@/types/tax-engine";

export type TaxDocumentType =
  | "sale"
  | "purchase"
  | "credit_note"
  | "debit_note"
  | "invoice"
  | "quote"
  | "other";

export type TaxIntegrationMode = "calculate" | "preview" | "validate";

export interface TaxCompanyRef {
  company_id: string;
  legal_name?: string | null;
  base_currency?: string | null;
}

/**
 * Opaque party metadata for future residency / reverse-charge rules.
 * No country-pack-specific fields.
 */
export interface TaxPartyMetadata {
  party_type?: "customer" | "supplier" | "none";
  party_id?: string | null;
  tax_number?: string | null;
  country_code?: string | null;
  attributes?: Readonly<Record<string, string>>;
}

export interface TaxIntegrationLineItem {
  line_id: string;
  quantity: number;
  unit_price: number;
  /** Absolute discount in document currency (default 0). */
  discount?: number;
  /**
   * Required tax category code (pack-defined, e.g. goods / services).
   * Missing category fails validation.
   */
  tax_category: string;
  /** Optional regime hint for Country Pack rule matching. */
  tax_regime?: string | null;
  /** Optional explicit tax code(s). */
  tax_code?: TaxCode | null;
  tax_codes?: readonly TaxCode[];
  price_mode?: TaxPriceMode;
  description?: string | null;
  attributes?: Readonly<Record<string, string>>;
}

/**
 * Generic operational Tax Request (integration layer).
 * No Netherlands-specific fields.
 */
export interface TaxRequest {
  request_id: string;
  company: TaxCompanyRef;
  /** ISO country code used to select the Country Pack (e.g. NL). */
  country: string;
  /** Optional jurisdiction override; defaults to pack jurisdiction. */
  jurisdiction?: string | null;
  document_type: TaxDocumentType | string;
  transaction_date: string;
  currency: string;
  customer?: TaxPartyMetadata | null;
  supplier?: TaxPartyMetadata | null;
  lines: readonly TaxIntegrationLineItem[];
}

export interface TaxLineResult {
  line_id: string;
  taxable_amount: number;
  tax_amount: number;
  net_amount: number;
  gross_amount: number;
  taxes: readonly TaxBreakdownLine[];
}

export interface TaxAppliedDefinition {
  tax_definition_id: string;
  tax_code: TaxCode;
  name: string;
  rate_value: number;
}

export interface TaxRoundingInfo {
  mode: TaxRoundingMode;
  decimal_places: number;
}

export type TaxValidationWarningCode =
  | "ZERO_TAX_AMOUNT"
  | "NO_TAX_APPLIED"
  | "MULTIPLE_TAXES_ON_LINE";

export interface TaxValidationWarning {
  code: TaxValidationWarningCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

/**
 * Integration Tax Result returned to operational modules.
 */
export interface TaxResult {
  request_id: string;
  mode: TaxIntegrationMode;
  country: string;
  currency: string;
  jurisdiction_id: string;
  document_type: string;
  transaction_date: string;
  net_total: number;
  tax_total: number;
  gross_total: number;
  /** tax_total / net_total when net_total > 0; otherwise 0. */
  effective_tax_rate: number;
  breakdown: TaxBreakdown;
  lines: readonly TaxLineResult[];
  applied_tax_definitions: readonly TaxAppliedDefinition[];
  rounding: TaxRoundingInfo;
  warnings: readonly TaxValidationWarning[];
  /** Present for validate mode when calculation was not required to succeed. */
  is_valid: boolean;
}

export type TaxIntegrationErrorCode =
  | "INVALID_TAX_REQUEST"
  | "MISSING_TAX_CATEGORY"
  | "INACTIVE_TAX"
  | "INVALID_JURISDICTION"
  | "MISSING_EFFECTIVE_RATE"
  | "DUPLICATE_TAX_CODE"
  | "COUNTRY_PACK_NOT_FOUND"
  | "TAX_ENGINE_FAILED";

export interface TaxIntegrationError {
  code: TaxIntegrationErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export type { TaxBreakdown, TaxBreakdownLine, TaxCode, TaxDefinition };
