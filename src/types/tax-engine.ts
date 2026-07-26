/**
 * Tax Engine contracts (DEV-096).
 *
 * Country-agnostic tax calculation foundation.
 * Localization Packs supply concrete tax regimes; this module never encodes
 * regime names, country names, or jurisdiction-specific tax labels.
 *
 * Canonical feature implementation: src/features/tax-engine/
 */

/** Opaque tax code assigned by a Localization Pack or configuration. */
export type TaxCode = string;

/** Opaque category grouping key (pack-defined). */
export type TaxCategoryCode = string;

/**
 * Opaque tax type key (pack-defined).
 * The engine treats this as configuration identity only.
 */
export type TaxTypeCode = string;

/** Opaque jurisdiction key (pack-defined). */
export type TaxJurisdictionCode = string;

/**
 * How a rate is applied to a taxable base.
 * Mechanics only — not a tax regime catalog.
 */
export type TaxApplicationMethod =
  | "percentage_of_base"
  | "percentage_of_gross"
  | "fixed_amount"
  | "amount_per_quantity";

/**
 * Whether the supplied line amount already includes tax.
 */
export type TaxPriceMode = "exclusive" | "inclusive";

/**
 * Direction relative to the organization for reporting packs.
 * Generic in/out — not regime-specific.
 */
export type TaxDirection = "input" | "output" | "neutral";

export type TaxRoundingMode =
  | "half_up"
  | "half_even"
  | "floor"
  | "ceil"
  | "truncate";

export interface TaxRoundingStrategy {
  mode: TaxRoundingMode;
  /** Decimal places for tax amounts (typically 2). */
  decimal_places: number;
  round(value: number): number;
}

export interface TaxCategory {
  id: string;
  code: TaxCategoryCode;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface TaxType {
  id: string;
  code: TaxTypeCode;
  name: string;
  application_method: TaxApplicationMethod;
  is_active: boolean;
  created_at: string;
}

export interface TaxJurisdiction {
  id: string;
  code: TaxJurisdictionCode;
  name: string;
  /** Optional parent for nested jurisdictions (pack-defined hierarchy). */
  parent_jurisdiction_id: string | null;
  is_active: boolean;
  created_at: string;
}

/**
 * Stable definition of a calculable tax.
 * Localization Packs instantiate these; the engine only evaluates them.
 */
export interface TaxDefinition {
  id: string;
  tax_code: TaxCode;
  category_id: string;
  type_id: string;
  jurisdiction_id: string;
  name: string;
  direction: TaxDirection;
  is_active: boolean;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

/**
 * Time-bounded numeric rate / amount for a TaxDefinition.
 */
export interface TaxRate {
  id: string;
  tax_definition_id: string;
  /** Percentage as a fraction (0.21 = 21%) or fixed/unit amount depending on method. */
  rate_value: number;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
}

/**
 * Rule that selects which TaxDefinition applies to a request line.
 * Match criteria are opaque string keys supplied by packs/callers.
 */
export interface TaxRule {
  id: string;
  tax_definition_id: string;
  /**
   * Higher priority wins when multiple rules match the same tax_code slot.
   */
  priority: number;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  /**
   * Optional jurisdiction filter. null = any jurisdiction in context.
   */
  jurisdiction_id: string | null;
  /**
   * Opaque match attributes (e.g. product class, customer class).
   * Engine performs exact key/value equality only — no regime logic.
   */
  match: Readonly<Record<string, string>>;
  description: string | null;
  created_at: string;
}

export interface TaxLineRequest {
  line_id: string;
  /** Taxable amount in transaction currency (interpretation depends on price_mode). */
  amount: number;
  quantity: number;
  currency: string;
  price_mode: TaxPriceMode;
  /**
   * Requested tax codes to evaluate for this line.
   * Empty = resolve all matching rules for the context.
   */
  tax_codes?: readonly TaxCode[];
  /** Opaque attributes used for rule matching. */
  attributes?: Readonly<Record<string, string>>;
}

/**
 * Input to the Tax Calculation Pipeline.
 */
export interface TaxCalculationContext {
  occurred_at: string;
  currency: string;
  jurisdiction_id: string;
  rounding: TaxRoundingStrategy;
  definitions: readonly TaxDefinition[];
  types: readonly TaxType[];
  rates: readonly TaxRate[];
  rules: readonly TaxRule[];
  categories?: readonly TaxCategory[];
  jurisdictions?: readonly TaxJurisdiction[];
}

export interface TaxRequest {
  request_id: string;
  lines: readonly TaxLineRequest[];
  context: TaxCalculationContext;
}

export interface TaxBreakdownLine {
  line_id: string;
  tax_code: TaxCode;
  tax_definition_id: string;
  tax_rule_id: string;
  tax_rate_id: string;
  jurisdiction_id: string;
  direction: TaxDirection;
  application_method: TaxApplicationMethod;
  /** Base amount used for calculation (exclusive taxable base). */
  taxable_base: number;
  rate_value: number;
  tax_amount: number;
  /** Amount excluding tax for this component. */
  net_amount: number;
  /** Amount including this tax component. */
  gross_amount: number;
}

export interface TaxBreakdown {
  lines: readonly TaxBreakdownLine[];
  /** Totals by tax_code across all request lines. */
  by_tax_code: Readonly<Record<TaxCode, number>>;
}

export interface TaxResult {
  request_id: string;
  currency: string;
  jurisdiction_id: string;
  net_total: number;
  tax_total: number;
  gross_total: number;
  breakdown: TaxBreakdown;
}

export type TaxErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_CONTEXT"
  | "DUPLICATE_TAX_CODE"
  | "RULE_NOT_FOUND"
  | "RATE_NOT_FOUND"
  | "DEFINITION_NOT_FOUND"
  | "TYPE_NOT_FOUND"
  | "INACTIVE_TAX"
  | "INVALID_AMOUNT"
  | "VALIDATION_FAILED";

export interface TaxError {
  code: TaxErrorCode;
  message: string;
  details?: Record<string, string | number | boolean | null>;
}

export type TaxPipelineResult =
  | { ok: true; data: TaxResult }
  | { ok: false; error: TaxError };

/**
 * Pluggable calculator for a single resolved tax application.
 * Default engine calculator covers built-in application methods.
 * Localization Packs may supply specialized calculators later.
 */
export interface TaxCalculator {
  calculate(input: {
    method: TaxApplicationMethod;
    rateValue: number;
    amount: number;
    quantity: number;
    priceMode: TaxPriceMode;
  }): { taxableBase: number; taxAmount: number; netAmount: number; grossAmount: number };
}
