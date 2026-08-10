/**
 * Purchases → Tax → Accounting integration coverage (DEV-090 / DEV-092 / DEV-100).
 *
 * Purchase Confirmed (received) + precomputed TaxResult
 * → generic Operational Accounting Integration → Journal Proposal.
 * Accounting never recalculates taxes. No ledger persistence from Purchases.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { roundMoney } from "@/lib/money";
import type {
  AccountRoleBinding,
  FiscalPeriod,
  PostingRule,
} from "@/types/accounting";
import type { PurchaseAccountingContext } from "../types/purchase-accounting";
import type { PurchaseTaxDocument, PurchaseTaxResult } from "../types/purchase-tax";
import type { PurchaseWithRelations } from "../types/purchase";

const { proposeSpy, calculateSpy, previewSpy, validateSpy, supabaseMock } =
  vi.hoisted(() => ({
    proposeSpy: vi.fn(),
    calculateSpy: vi.fn(),
    previewSpy: vi.fn(),
    validateSpy: vi.fn(),
    supabaseMock: {
      from: vi.fn(),
      rpc: vi.fn(),
      auth: { getUser: vi.fn() },
    },
  }));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock(
  "@/features/accounting/services/operational-accounting-integration-service",
  async () => {
    const actual = await vi.importActual<
      typeof import("@/features/accounting/services/operational-accounting-integration-service")
    >(
      "@/features/accounting/services/operational-accounting-integration-service",
    );
    return {
      operationalAccountingIntegrationService: {
        ...actual.operationalAccountingIntegrationService,
        propose: (
          ...args: Parameters<
            typeof actual.operationalAccountingIntegrationService.propose
          >
        ) => {
          proposeSpy(...args);
          return actual.operationalAccountingIntegrationService.propose(
            ...args,
          );
        },
      },
    };
  },
);

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

import { purchaseAccountingService } from "./purchase-accounting-service";
import { purchaseTaxService } from "./purchase-tax-service";
import { createPurchaseReceivedPostingRule } from "./purchase-received-posting-rule";

/**
 * Fixture-only NL rate table for the calculate_purchase_taxes RPC mock below.
 * Mirrors sql/071_accounting_vat_netherlands_seed.sql for exactly the
 * category/regime combinations exercised in this file (all percentage_of_base,
 * all exclusive price_mode — no legacy-rate date branching needed here).
 */
const NL_RATE_FIXTURES: Record<
  string,
  { tax_code: string; rate: number; direction: "output" | "input" | "neutral" }
> = {
  "goods:standard_vat": {
    tax_code: "NL-VAT-STD-21",
    rate: 0.21,
    direction: "output",
  },
  "food:reduced_vat": {
    tax_code: "NL-VAT-RED-9",
    rate: 0.09,
    direction: "output",
  },
  "goods:zero_rate": {
    tax_code: "NL-VAT-ZERO-0",
    rate: 0,
    direction: "output",
  },
  "services:reverse_charge": {
    tax_code: "NL-VAT-RC",
    rate: 0,
    direction: "neutral",
  },
  "goods:small_business_scheme_kor": {
    tax_code: "NL-VAT-KOR",
    rate: 0,
    direction: "neutral",
  },
};

interface MockPurchaseTaxLineParams {
  line_id: string;
  quantity: number;
  unit_price: number;
  discount?: number;
  tax_category: string;
  tax_regime?: string | null;
}

/**
 * Installs a calculate_purchase_taxes RPC mock so requireTax()/proposeWithTax()
 * below can exercise the real purchaseTaxService (now RPC-based) without a
 * database. Computes real percentage_of_base arithmetic from NL_RATE_FIXTURES
 * instead of hand-typed canned totals, so multi-line/multi-tax aggregation is
 * still genuinely exercised.
 */
function mockCalculatePurchaseTaxesRpc() {
  supabaseMock.rpc.mockImplementation(
    async (fn: string, params: Record<string, unknown>) => {
      if (fn !== "calculate_purchase_taxes") {
        return { data: null, error: { message: `Unexpected rpc: ${fn}` } };
      }

      const lines = params.p_lines as MockPurchaseTaxLineParams[];
      let subtotal = 0;
      let taxTotal = 0;

      const outLines = lines.map((line) => {
        const amount = roundMoney(
          line.quantity * line.unit_price - (line.discount ?? 0),
        );
        const fixture =
          NL_RATE_FIXTURES[`${line.tax_category}:${line.tax_regime ?? ""}`];
        const taxes = fixture
          ? [
              {
                tax_code: fixture.tax_code,
                tax_definition_id: `def-${fixture.tax_code}`,
                tax_rule_id: `rule-${fixture.tax_code}`,
                jurisdiction_id: "jur-nl",
                direction: fixture.direction,
                application_method: "percentage_of_base",
                taxable_base: amount,
                rate_value: fixture.rate,
                tax_amount: roundMoney(amount * fixture.rate),
                net_amount: amount,
                gross_amount: roundMoney(amount + amount * fixture.rate),
              },
            ]
          : [];
        const lineTax = roundMoney(
          taxes.reduce((sum, tax) => sum + tax.tax_amount, 0),
        );

        subtotal = roundMoney(subtotal + amount);
        taxTotal = roundMoney(taxTotal + lineTax);

        return {
          line_id: line.line_id,
          taxable_amount: amount,
          tax_amount: lineTax,
          net_amount: amount,
          gross_amount: roundMoney(amount + lineTax),
          taxes,
        };
      });

      return {
        data: {
          country: params.p_country,
          jurisdiction_id: "jur-nl",
          jurisdiction_code: "NL",
          currency: params.p_currency,
          transaction_date: params.p_transaction_date,
          rounding: { mode: "half_up", decimal_places: 2 },
          subtotal,
          tax_total: taxTotal,
          grand_total: roundMoney(subtotal + taxTotal),
          effective_tax_rate: subtotal > 0 ? taxTotal / subtotal : 0,
          lines: outLines,
          by_tax_code: {},
          is_valid: true,
        },
        error: null,
      };
    },
  );
}

function period(overrides?: Partial<FiscalPeriod>): FiscalPeriod {
  return {
    id: "period-1",
    name: "2026-Q3",
    start_date: "2026-07-01",
    end_date: "2026-09-30",
    status: "open",
    closed_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function purchase(
  overrides?: Partial<PurchaseWithRelations>,
): PurchaseWithRelations {
  return {
    id: "purchase-1",
    supplier_id: "supplier-1",
    status: "received",
    invoice_number: "INV-100",
    notes: null,
    subtotal: 200,
    tax_total: 40,
    total: 240,
    currency: "EUR",
    purchased_at: "2026-07-26T09:00:00.000Z",
    transaction_id: "txn-1",
    production_plan_id: null,
    created_at: "2026-07-26T09:00:00.000Z",
    supplier: { id: "supplier-1", name: "Dairy Co" },
    items: [
      {
        id: "item-1",
        purchase_id: "purchase-1",
        ingredient_id: "ing-1",
        quantity: 10,
        unit_cost: 20,
        line_total: 200,
        ingredient: { id: "ing-1", name: "Milk", unit: "L" },
      },
    ],
    ...overrides,
  };
}

function bindings(): AccountRoleBinding[] {
  return [
    {
      id: "bind-inventory",
      role: "inventory_asset",
      account_id: "acct-inventory",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "bind-vat-input",
      role: "vat_input",
      account_id: "acct-vat-input",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
    {
      id: "bind-ap",
      role: "accounts_payable",
      account_id: "acct-ap",
      effective_from: "2020-01-01",
      effective_to: null,
      is_active: true,
      created_at: "2020-01-01T00:00:00.000Z",
    },
  ];
}

function accounting(
  overrides?: Partial<PurchaseAccountingContext>,
): PurchaseAccountingContext {
  let seq = 0;
  return {
    fiscalPeriod: period(),
    accountRoleBindings: bindings(),
    baseCurrency: "EUR",
    exchangeRate: 1,
    rateDate: "2026-07-26",
    nowIso: "2026-07-26T12:00:00.000Z",
    createId: () => {
      seq += 1;
      return `id-${seq}`;
    },
    accountsById: {
      "acct-inventory": {
        id: "acct-inventory",
        is_postable: true,
        is_active: true,
      },
      "acct-vat-input": {
        id: "acct-vat-input",
        is_postable: true,
        is_active: true,
      },
      "acct-ap": {
        id: "acct-ap",
        is_postable: true,
        is_active: true,
      },
    },
    ...overrides,
  };
}

function taxDocument(
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
        quantity: 1,
        unit_price: 100,
        discount: 0,
        tax_category: "goods",
        tax_regime: "standard_vat",
      },
    ],
    ...overrides,
  };
}

async function requireTax(
  document: PurchaseTaxDocument,
): Promise<PurchaseTaxResult> {
  const result = await purchaseTaxService.calculatePurchaseTaxes(document);
  if (result.error || !result.data) {
    throw new Error(result.error ?? "Failed to build tax fixture");
  }
  return result.data;
}

function stubTaxResult(
  overrides?: Partial<Omit<PurchaseTaxResult, "tax_result">> & {
    tax_result?: Partial<PurchaseTaxResult["tax_result"]>;
  },
): PurchaseTaxResult {
  const { tax_result: taxResultOverrides, ...rest } = overrides ?? {};
  const net = rest.subtotal ?? 100;
  const tax = rest.tax_total ?? 21;
  const gross = rest.grand_total ?? net + tax;

  return {
    document_id: "purchase-1",
    mode: "calculate",
    is_valid: true,
    subtotal: net,
    tax_total: tax,
    grand_total: gross,
    effective_tax_rate: net > 0 ? tax / net : 0,
    lines: [
      {
        line_id: "line-1",
        tax_code: "NL-VAT-STD-21",
        tax_rate_percent: 21,
        tax_amount: tax,
        taxable_amount: net,
        net_amount: net,
        gross_amount: gross,
      },
    ],
    warnings: [],
    ...rest,
    tax_result: {
      currency: "EUR",
      breakdown: {
        lines: [
          {
            tax_code: "NL-VAT-STD-21",
            direction: "input",
            rate_value: 0.21,
            net_amount: net,
            tax_amount: tax,
          },
        ],
      },
      ...taxResultOverrides,
    },
  };
}

async function proposeWithTax(
  doc: PurchaseTaxDocument,
  purchaseOverrides?: Partial<PurchaseWithRelations>,
  accountingOverrides?: Partial<PurchaseAccountingContext>,
) {
  const tax = await requireTax(doc);
  calculateSpy.mockClear();
  previewSpy.mockClear();
  validateSpy.mockClear();

  const alignedPurchase = purchase({
    subtotal: tax.subtotal,
    tax_total: tax.tax_total,
    total: tax.grand_total,
    currency: doc.currency,
    ...purchaseOverrides,
  });

  return {
    tax,
    result: purchaseAccountingService.proposeJournalForPurchaseReceived(
      alignedPurchase,
      accounting(accountingOverrides),
      tax,
    ),
  };
}

describe("purchaseAccountingService (DEV-100)", () => {
  beforeEach(() => {
    proposeSpy.mockClear();
    calculateSpy.mockClear();
    previewSpy.mockClear();
    validateSpy.mockClear();
    supabaseMock.rpc.mockReset();
    mockCalculatePurchaseTaxesRpc();
  });

  it("routes Purchases through the generic Accounting integration framework", async () => {
    const { result, tax } = await proposeWithTax(taxDocument());

    expect(result.error).toBeNull();
    expect(proposeSpy).toHaveBeenCalledTimes(1);
    expect(proposeSpy.mock.calls[0]?.[0]).toMatchObject({
      mode: "propose",
      event: {
        event_type: "purchase_received",
        source_module: "purchases",
        source_document_id: "purchase-1",
        amounts: {
          net_amount: tax.subtotal,
          tax_amount: tax.tax_total,
          gross_amount: tax.grand_total,
        },
      },
      metadata: {
        source_module: "purchases",
        source_document_type: "purchase",
        source_document_id: "purchase-1",
        idempotency_key: "purchase_received:purchase-1",
      },
    });
  });

  it("proposes standard VAT journal: Dr Inventory / Dr Recoverable VAT / Cr AP", async () => {
    const { result } = await proposeWithTax(taxDocument());

    expect(result.error).toBeNull();
    expect(result.data?.journalProposal.journal_entry.status).toBe("posted");
    expect(result.data?.journalProposal.journal_lines).toHaveLength(3);

    const inventory = result.data?.journalProposal.journal_lines.find(
      (line) => line.account_id === "acct-inventory",
    );
    const vat = result.data?.journalProposal.journal_lines.find(
      (line) => line.account_id === "acct-vat-input",
    );
    const ap = result.data?.journalProposal.journal_lines.find(
      (line) => line.account_id === "acct-ap",
    );

    expect(inventory?.debit_base).toBe(100);
    expect(vat?.debit_base).toBe(21);
    expect(ap?.credit_base).toBe(121);
    expect(result.data?.tax.tax_total).toBe(21);
  });

  it("proposes reduced VAT journal from TaxResult amounts", async () => {
    const { result } = await proposeWithTax(
      taxDocument({
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
    expect(result.data?.tax.tax_total).toBe(9);

    const vat = result.data?.journalProposal.journal_lines.find(
      (line) => line.account_id === "acct-vat-input",
    );
    const ap = result.data?.journalProposal.journal_lines.find(
      (line) => line.account_id === "acct-ap",
    );
    expect(vat?.debit_base).toBe(9);
    expect(ap?.credit_base).toBe(109);
  });

  it("omits recoverable VAT line for zero VAT (balanced Dr net / Cr gross)", async () => {
    const { result } = await proposeWithTax(
      taxDocument({
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
    expect(result.data?.tax.tax_total).toBe(0);
    expect(result.data?.journalProposal.journal_lines).toHaveLength(2);

    const inventory = result.data?.journalProposal.journal_lines.find(
      (line) => line.account_id === "acct-inventory",
    );
    const vat = result.data?.journalProposal.journal_lines.find(
      (line) => line.account_id === "acct-vat-input",
    );
    const ap = result.data?.journalProposal.journal_lines.find(
      (line) => line.account_id === "acct-ap",
    );

    expect(vat).toBeUndefined();
    expect(inventory?.debit_base).toBe(100);
    expect(ap?.credit_base).toBe(100);
  });

  it("supports reverse charge with zero tax and tax_line propagation", async () => {
    const { result, tax } = await proposeWithTax(
      taxDocument({
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
    expect(tax.tax_total).toBe(0);
    expect(tax.lines[0]?.tax_code).toBe("NL-VAT-RC");
    expect(result.data?.journalProposal.journal_lines).toHaveLength(2);
    expect(proposeSpy.mock.calls[0]?.[0].event.tax_lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tax_code: "NL-VAT-RC",
          tax_amount: 0,
          direction: "input",
        }),
      ]),
    );
  });

  it("supports KOR (small business scheme) with zero tax", async () => {
    const { result, tax } = await proposeWithTax(
      taxDocument({
        lines: [
          {
            line_id: "line-1",
            quantity: 1,
            unit_price: 80,
            tax_category: "goods",
            tax_regime: "small_business_scheme_kor",
          },
        ],
      }),
    );

    expect(result.error).toBeNull();
    expect(tax.tax_total).toBe(0);
    expect(tax.lines[0]?.tax_code).toBe("NL-VAT-KOR");
    expect(result.data?.journalProposal.journal_lines).toHaveLength(2);
  });

  it("supports multi-tax purchases via aggregated tax_amount and tax_lines", async () => {
    const { result, tax } = await proposeWithTax(
      taxDocument({
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
    expect(tax.tax_total).toBe(30);
    expect(tax.lines).toHaveLength(2);

    const inventory = result.data?.journalProposal.journal_lines.find(
      (line) => line.account_id === "acct-inventory",
    );
    const vat = result.data?.journalProposal.journal_lines.find(
      (line) => line.account_id === "acct-vat-input",
    );
    const ap = result.data?.journalProposal.journal_lines.find(
      (line) => line.account_id === "acct-ap",
    );

    expect(inventory?.debit_base).toBe(200);
    expect(vat?.debit_base).toBe(30);
    expect(ap?.credit_base).toBe(230);
    expect(proposeSpy.mock.calls[0]?.[0].event.tax_lines).toHaveLength(2);
  });

  it("propagates TaxResult amounts into the business event without mutation", () => {
    const tax = stubTaxResult({
      subtotal: 200,
      tax_total: 40,
      grand_total: 240,
    });

    const eventResult =
      purchaseAccountingService.buildPurchaseReceivedBusinessEvent(
        purchase(),
        accounting(),
        tax,
      );

    expect(eventResult.error).toBeNull();
    expect(eventResult.data?.amounts).toEqual({
      gross_amount: 240,
      net_amount: 200,
      tax_amount: 40,
      cogs_amount: null,
      discount_amount: null,
      shipping_amount: null,
      other_amount: null,
    });
    expect(eventResult.data?.tax_lines[0]).toMatchObject({
      tax_code: "NL-VAT-STD-21",
      rate: 0.21,
      net_amount: 200,
      tax_amount: 40,
      direction: "input",
    });
  });

  it("does not recalculate taxes during journal proposal", () => {
    const tax = stubTaxResult();
    calculateSpy.mockClear();

    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase({
        subtotal: tax.subtotal,
        tax_total: tax.tax_total,
        total: tax.grand_total,
      }),
      accounting(),
      tax,
    );

    expect(result.error).toBeNull();
    expect(calculateSpy).not.toHaveBeenCalled();
    expect(previewSpy).not.toHaveBeenCalled();
    expect(validateSpy).not.toHaveBeenCalled();
    expect(result.data?.tax).toBe(tax);
  });

  it("rejects missing tax result", () => {
    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase(),
      accounting(),
      undefined as unknown as PurchaseTaxResult,
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/tax result is required/i);
  });

  it("rejects invalid / inactive tax results", () => {
    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase(),
      accounting(),
      stubTaxResult({ is_valid: false }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/invalid/i);
  });

  it("rejects validate-only tax results for accounting proposals", () => {
    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase(),
      accounting(),
      stubTaxResult({ mode: "validate" }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/validation-only/i);
  });

  it("rejects draft purchases that are not confirmed", () => {
    const eventResult =
      purchaseAccountingService.buildPurchaseReceivedBusinessEvent(
        purchase({ status: "draft" }),
        accounting(),
        stubTaxResult(),
      );

    expect(eventResult.data).toBeNull();
    expect(eventResult.error).toMatch(/confirmed \(received\)/i);
  });

  it("fails when the posting rule is inactive / invalid for the event", () => {
    const inactiveRule: PostingRule = createPurchaseReceivedPostingRule({
      is_active: false,
    });

    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase(),
      accounting({ postingRules: [inactiveRule] }),
      stubTaxResult({ subtotal: 200, tax_total: 40, grand_total: 240 }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/no active posting rule/i);
  });

  it("fails when recoverable VAT role binding is missing and tax > 0", () => {
    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase(),
      accounting({
        accountRoleBindings: bindings().filter(
          (row) => row.role !== "vat_input",
        ),
      }),
      stubTaxResult({ subtotal: 200, tax_total: 40, grand_total: 240 }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/no active account binding/i);
  });

  it("detects imbalance when a custom rule uses unequal amount fields", () => {
    const imbalancedRule = createPurchaseReceivedPostingRule({
      id: "imbalanced-purchase-rule",
      lines: [
        {
          id: "d1",
          posting_rule_id: "imbalanced-purchase-rule",
          line_no: 1,
          account_role: "inventory_asset",
          side: "debit",
          amount_field: "gross_amount",
          currency_source: "event_transaction",
          tax_behaviour: "none",
          tax_code: null,
          description: "Inventory",
        },
        {
          id: "c1",
          posting_rule_id: "imbalanced-purchase-rule",
          line_no: 2,
          account_role: "accounts_payable",
          side: "credit",
          amount_field: "net_amount",
          currency_source: "event_transaction",
          tax_behaviour: "none",
          tax_code: null,
          description: "AP",
        },
      ],
    });

    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase(),
      accounting({ postingRules: [imbalancedRule] }),
      stubTaxResult({ subtotal: 200, tax_total: 40, grand_total: 240 }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/not balanced/i);
  });

  it("supports foreign currency purchases via exchange_rate", () => {
    const tax = stubTaxResult({
      subtotal: 100,
      tax_total: 21,
      grand_total: 121,
    });

    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase({
        currency: "USD",
        subtotal: 100,
        tax_total: 21,
        total: 121,
      }),
      accounting({
        baseCurrency: "EUR",
        exchangeRate: 0.9,
      }),
      tax,
    );

    expect(result.error).toBeNull();
    const lines = result.data?.journalProposal.journal_lines ?? [];
    const inventory = lines.find((line) => line.account_id === "acct-inventory");
    const vat = lines.find((line) => line.account_id === "acct-vat-input");
    const ap = lines.find((line) => line.account_id === "acct-ap");

    expect(inventory?.debit_transaction).toBe(100);
    expect(inventory?.debit_base).toBe(90);
    expect(vat?.debit_transaction).toBe(21);
    expect(vat?.debit_base).toBe(18.9);
    expect(ap?.credit_transaction).toBe(121);
    expect(ap?.credit_base).toBe(108.9);
    expect(result.data?.journalProposal.journal_entry.transaction_currency).toBe(
      "USD",
    );
    expect(result.data?.journalProposal.journal_entry.base_currency).toBe("EUR");
  });

  it("fails when the fiscal period is closed", () => {
    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase(),
      accounting({
        fiscalPeriod: period({
          status: "closed",
          closed_at: "2026-07-31T00:00:00.000Z",
        }),
      }),
      stubTaxResult({ subtotal: 200, tax_total: 40, grand_total: 240 }),
    );

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/not open for posting/i);
  });

  it("resolves tax account from posting role bindings — never hardcoded", () => {
    const result = purchaseAccountingService.proposeJournalForPurchaseReceived(
      purchase({
        subtotal: 100,
        tax_total: 21,
        total: 121,
      }),
      accounting({
        accountRoleBindings: bindings().map((row) =>
          row.role === "vat_input"
            ? { ...row, account_id: "acct-recoverable-tax-custom" }
            : row,
        ),
        accountsById: {
          "acct-inventory": {
            id: "acct-inventory",
            is_postable: true,
            is_active: true,
          },
          "acct-recoverable-tax-custom": {
            id: "acct-recoverable-tax-custom",
            is_postable: true,
            is_active: true,
          },
          "acct-ap": {
            id: "acct-ap",
            is_postable: true,
            is_active: true,
          },
        },
      }),
      stubTaxResult(),
    );

    expect(result.error).toBeNull();
    const vat = result.data?.journalProposal.journal_lines.find(
      (line) => line.debit_base === 21,
    );
    expect(vat?.account_id).toBe("acct-recoverable-tax-custom");
  });
});
