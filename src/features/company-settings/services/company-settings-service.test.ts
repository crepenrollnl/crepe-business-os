/**
 * Service-level coverage for companySettingsService (DEV-051).
 *
 * get / update must go only through SQL RPCs.
 * The service must not write company_settings tables directly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_NAME_LENGTH, MAX_NOTES_LENGTH } from "@/constants/limits";

const { supabaseMock } = vi.hoisted(() => {
  const supabaseMock = {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(),
    },
  };
  return { supabaseMock };
});

vi.mock("@/lib/supabase", () => ({
  supabase: supabaseMock,
}));

import { companySettingsService } from "./company-settings-service";
import type { CompanySettings } from "../types/company-settings";

const SETTINGS_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const insertMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();

function settingsRow(overrides?: Record<string, unknown>) {
  return {
    id: SETTINGS_ID,
    company_name: "Crepe'n Roll",
    legal_name: null,
    vat_number: null,
    kvk_number: null,
    address: null,
    postal_code: null,
    city: null,
    country: null,
    phone: null,
    email: null,
    website: null,
    currency_code: "EUR",
    timezone: "Europe/Amsterdam",
    created_at: "2026-07-25T10:00:00.000Z",
    updated_at: "2026-07-25T10:00:00.000Z",
    ...overrides,
  };
}

function mappedSettings(
  overrides?: Partial<CompanySettings>,
): CompanySettings {
  return {
    id: SETTINGS_ID,
    companyName: "Crepe'n Roll",
    legalName: null,
    vatNumber: null,
    kvkNumber: null,
    address: null,
    postalCode: null,
    city: null,
    country: null,
    phone: null,
    email: null,
    website: null,
    currencyCode: "EUR",
    timezone: "Europe/Amsterdam",
    createdAt: "2026-07-25T10:00:00.000Z",
    updatedAt: "2026-07-25T10:00:00.000Z",
    ...overrides,
  };
}

function expectNoDirectWrites() {
  expect(supabaseMock.from).not.toHaveBeenCalled();
  expect(insertMock).not.toHaveBeenCalled();
  expect(updateMock).not.toHaveBeenCalled();
  expect(deleteMock).not.toHaveBeenCalled();
}

describe("companySettingsService (DEV-051)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertMock.mockReset();
    updateMock.mockReset();
    deleteMock.mockReset();
    supabaseMock.from.mockImplementation(() => ({
      select: vi.fn(),
      insert: insertMock,
      update: updateMock,
      delete: deleteMock,
    }));
  });

  describe("getCompanySettings", () => {
    it("reads successfully via get_company_settings and maps the DTO", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: settingsRow({
          legal_name: "Crepe'n Roll B.V.",
          city: "Amsterdam",
          country: "NL",
        }),
        error: null,
      });

      const result = await companySettingsService.getCompanySettings();

      expect(result.error).toBeNull();
      expect(result.data).toEqual(
        mappedSettings({
          legalName: "Crepe'n Roll B.V.",
          city: "Amsterdam",
          country: "NL",
        }) satisfies CompanySettings,
      );
      expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
      expect(supabaseMock.rpc).toHaveBeenCalledWith("get_company_settings");
      expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
      expectNoDirectWrites();
    });

    it("maps empty/default settings fields as null", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: settingsRow(),
        error: null,
      });

      const result = await companySettingsService.getCompanySettings();

      expect(result.error).toBeNull();
      expect(result.data).toEqual(mappedSettings() satisfies CompanySettings);
      expect(result.data?.legalName).toBeNull();
      expect(result.data?.vatNumber).toBeNull();
      expect(result.data?.kvkNumber).toBeNull();
      expect(result.data?.address).toBeNull();
      expectNoDirectWrites();
    });

    it("is read-only and never writes tables", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: settingsRow(),
        error: null,
      });

      await companySettingsService.getCompanySettings();

      expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
        "get_company_settings",
      ]);
      expectNoDirectWrites();
    });

    it("maps missing get_company_settings function errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Could not find the function public.get_company_settings",
        },
      });

      const result = await companySettingsService.getCompanySettings();

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Company settings are not available yet. Apply the company settings database script and try again.",
      );
      expectNoDirectWrites();
    });

    it("maps not-found RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Company settings were not found.",
        },
      });

      const result = await companySettingsService.getCompanySettings();

      expect(result.data).toBeNull();
      expect(result.error).toBe("Company settings were not found.");
    });

    it("rejects invalid RPC payloads", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: settingsRow({ id: "not-a-uuid" }),
        error: null,
      });

      const result = await companySettingsService.getCompanySettings();

      expect(result.data).toBeNull();
      expect(result.error).toBe("Company settings response was invalid.");
    });
  });

  describe("updateCompanySettings", () => {
    it("updates successfully and returns a typed DTO", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: settingsRow({
          company_name: "Updated Crepe",
          email: "hello@crepe.test",
          updated_at: "2026-07-25T12:00:00.000Z",
        }),
        error: null,
      });

      const result = await companySettingsService.updateCompanySettings({
        company_name: "Updated Crepe",
        email: "hello@crepe.test",
      });

      expect(result.error).toBeNull();
      expect(result.data).toEqual(
        mappedSettings({
          companyName: "Updated Crepe",
          email: "hello@crepe.test",
          updatedAt: "2026-07-25T12:00:00.000Z",
        }) satisfies CompanySettings,
      );
      expect(supabaseMock.rpc).toHaveBeenCalledWith("update_company_settings", {
        p_company_name: "Updated Crepe",
        p_legal_name: null,
        p_vat_number: null,
        p_kvk_number: null,
        p_address: null,
        p_postal_code: null,
        p_city: null,
        p_country: null,
        p_phone: null,
        p_email: "hello@crepe.test",
        p_website: null,
        p_currency_code: null,
        p_timezone: null,
      });
      expect(supabaseMock.auth.getUser).not.toHaveBeenCalled();
      expectNoDirectWrites();
    });

    it("sends null for omitted fields on partial update", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: settingsRow({ phone: "+31201234567" }),
        error: null,
      });

      const result = await companySettingsService.updateCompanySettings({
        phone: "+31201234567",
      });

      expect(result.error).toBeNull();
      expect(supabaseMock.rpc).toHaveBeenCalledWith("update_company_settings", {
        p_company_name: null,
        p_legal_name: null,
        p_vat_number: null,
        p_kvk_number: null,
        p_address: null,
        p_postal_code: null,
        p_city: null,
        p_country: null,
        p_phone: "+31201234567",
        p_email: null,
        p_website: null,
        p_currency_code: null,
        p_timezone: null,
      });
      expectNoDirectWrites();
    });

    it("rejects blank company name without calling the RPC", async () => {
      const result = await companySettingsService.updateCompanySettings({
        company_name: "   ",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Company name is required.");
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
      expectNoDirectWrites();
    });

    it("rejects oversized company name without calling the RPC", async () => {
      const result = await companySettingsService.updateCompanySettings({
        company_name: "A".repeat(MAX_NAME_LENGTH + 1),
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        `Company name must be ${MAX_NAME_LENGTH} characters or fewer.`,
      );
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects blank currency code and timezone without calling the RPC", async () => {
      const currency = await companySettingsService.updateCompanySettings({
        currency_code: "   ",
      });
      expect(currency.data).toBeNull();
      expect(currency.error).toBe("Currency code is required.");

      const timezone = await companySettingsService.updateCompanySettings({
        timezone: "   ",
      });
      expect(timezone.data).toBeNull();
      expect(timezone.error).toBe("Timezone is required.");

      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("rejects oversized address without calling the RPC", async () => {
      const result = await companySettingsService.updateCompanySettings({
        address: "A".repeat(MAX_NOTES_LENGTH + 1),
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        `Address must be ${MAX_NOTES_LENGTH} characters or fewer.`,
      );
      expect(supabaseMock.rpc).not.toHaveBeenCalled();
    });

    it("maps company-name-required RPC errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Company name is required.",
        },
      });

      const result = await companySettingsService.updateCompanySettings({
        company_name: "Valid Name",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe("Company name is required.");
      expectNoDirectWrites();
    });

    it("maps missing update_company_settings function errors", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: null,
        error: {
          message: "Could not find the function public.update_company_settings",
        },
      });

      const result = await companySettingsService.updateCompanySettings({
        company_name: "Valid Name",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Company settings are not available yet. Apply the company settings database script and try again.",
      );
    });

    it("rejects invalid update RPC payloads", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: settingsRow({ company_name: "" }),
        error: null,
      });

      const result = await companySettingsService.updateCompanySettings({
        company_name: "Valid Name",
      });

      expect(result.data).toBeNull();
      expect(result.error).toBe(
        "Company settings updated but the response was invalid.",
      );
    });

    it("never writes company_settings directly", async () => {
      supabaseMock.rpc.mockResolvedValue({
        data: settingsRow(),
        error: null,
      });

      await companySettingsService.updateCompanySettings({
        company_name: "Crepe'n Roll",
      });

      expect(supabaseMock.rpc.mock.calls.map((call) => call[0])).toEqual([
        "update_company_settings",
      ]);
      expectNoDirectWrites();
    });
  });
});
