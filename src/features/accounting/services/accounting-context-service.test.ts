/**
 * Accounting Context service coverage.
 *
 * Assembles fiscalPeriod / accountRoleBindings / baseCurrency /
 * transactionCurrency / exchangeRate / rateDate for both
 * ProductionAccountingContext and SaleAccountingContext.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock, getCompanySettingsMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
  getCompanySettingsMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

vi.mock("@/features/company-settings/services/company-settings-service", () => ({
  companySettingsService: {
    getCompanySettings: (...args: unknown[]) => getCompanySettingsMock(...args),
  },
}));

import { accountingContextService } from "./accounting-context-service";

const FISCAL_PERIOD_ROW = {
  id: "period-1",
  name: "FY2026",
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  status: "open",
  closed_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

const BINDING_ROWS = [
  {
    id: "binding-1",
    role: "revenue",
    account_id: "acct-4000",
    effective_from: "2020-01-01",
    effective_to: null,
    is_active: true,
    created_at: "2020-01-01T00:00:00.000Z",
  },
];

function fiscalPeriodChain(result: { data: unknown; error: unknown }) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = vi.fn(self);
  api.eq = vi.fn(self);
  api.lte = vi.fn(self);
  api.gte = vi.fn(self);
  api.maybeSingle = vi.fn(async () => result);
  return api;
}

function bindingsChain(result: { data: unknown; error: unknown }) {
  const api: Record<string, unknown> = {};
  const self = () => api;
  api.select = vi.fn(self);
  // Terminal call for this query is `.eq(...)` itself (no maybeSingle) —
  // make eq both chainable and awaitable by giving it a `then`.
  api.eq = vi.fn(() => Promise.resolve(result));
  return api;
}

function installMocks(options: {
  fiscalPeriod?: { data: unknown; error: unknown };
  bindings?: { data: unknown; error: unknown };
}) {
  const fiscalPeriodResult = options.fiscalPeriod ?? {
    data: FISCAL_PERIOD_ROW,
    error: null,
  };
  const bindingsResult = options.bindings ?? {
    data: BINDING_ROWS,
    error: null,
  };

  supabaseMock.from.mockImplementation((table: string) => {
    if (table === "fiscal_periods") {
      return fiscalPeriodChain(fiscalPeriodResult);
    }
    if (table === "account_role_bindings") {
      return bindingsChain(bindingsResult);
    }
    throw new Error(`Unexpected table: ${table}`);
  });
}

describe("accountingContextService.getCurrentAccountingContext", () => {
  beforeEach(() => {
    supabaseMock.from.mockReset();
    getCompanySettingsMock.mockReset();
  });

  it("assembles the context from an open fiscal period, active bindings, and company currency", async () => {
    installMocks({});
    getCompanySettingsMock.mockResolvedValue({
      data: { currencyCode: "EUR" },
      error: null,
    });

    const result = await accountingContextService.getCurrentAccountingContext();

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      fiscalPeriod: FISCAL_PERIOD_ROW,
      accountRoleBindings: BINDING_ROWS,
      baseCurrency: "EUR",
      transactionCurrency: "EUR",
      exchangeRate: 1,
      rateDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it("fails clearly when no open fiscal period covers today, instead of defaulting", async () => {
    installMocks({ fiscalPeriod: { data: null, error: null } });
    getCompanySettingsMock.mockResolvedValue({
      data: { currencyCode: "EUR" },
      error: null,
    });

    const result = await accountingContextService.getCurrentAccountingContext();

    expect(result.data).toBeNull();
    expect(result.error).toMatch(/no open fiscal period/i);
  });

  it("fails when account role bindings cannot be loaded", async () => {
    installMocks({
      bindings: { data: null, error: { message: "boom" } },
    });
    getCompanySettingsMock.mockResolvedValue({
      data: { currencyCode: "EUR" },
      error: null,
    });

    const result = await accountingContextService.getCurrentAccountingContext();

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("fails when company settings cannot be loaded", async () => {
    installMocks({});
    getCompanySettingsMock.mockResolvedValue({
      data: null,
      error: "Company settings were not found.",
    });

    const result = await accountingContextService.getCurrentAccountingContext();

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});
