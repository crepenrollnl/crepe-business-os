/**
 * Company Settings service (DEV-051).
 *
 * Orchestrates get_company_settings and update_company_settings only.
 * Does NOT write company_settings outside those RPCs, cache, or authenticate.
 */

import { MAX_NAME_LENGTH, MAX_NOTES_LENGTH } from "@/constants/limits";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  CompanySettings,
  UpdateCompanySettingsInput,
} from "../types/company-settings";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_CURRENCY_CODE_LENGTH = 16;
const MAX_TIMEZONE_LENGTH = 64;

function rpcErrorMessage(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return typeof error === "string" ? error : null;
}

function nullableString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return undefined;
}

function validateUpdateCompanySettingsInput(
  input: UpdateCompanySettingsInput,
): string | null {
  if (input.company_name !== undefined && input.company_name !== null) {
    const companyName = input.company_name.trim();
    if (companyName.length === 0) {
      return "Company name is required.";
    }
    if (companyName.length > MAX_NAME_LENGTH) {
      return `Company name must be ${MAX_NAME_LENGTH} characters or fewer.`;
    }
  }

  if (input.legal_name !== undefined && input.legal_name !== null) {
    if (input.legal_name.trim().length > MAX_NAME_LENGTH) {
      return `Legal name must be ${MAX_NAME_LENGTH} characters or fewer.`;
    }
  }

  if (input.address !== undefined && input.address !== null) {
    if (input.address.trim().length > MAX_NOTES_LENGTH) {
      return `Address must be ${MAX_NOTES_LENGTH} characters or fewer.`;
    }
  }

  if (input.currency_code !== undefined && input.currency_code !== null) {
    const currencyCode = input.currency_code.trim();
    if (currencyCode.length === 0) {
      return "Currency code is required.";
    }
    if (currencyCode.length > MAX_CURRENCY_CODE_LENGTH) {
      return `Currency code must be ${MAX_CURRENCY_CODE_LENGTH} characters or fewer.`;
    }
  }

  if (input.timezone !== undefined && input.timezone !== null) {
    const timezone = input.timezone.trim();
    if (timezone.length === 0) {
      return "Timezone is required.";
    }
    if (timezone.length > MAX_TIMEZONE_LENGTH) {
      return `Timezone must be ${MAX_TIMEZONE_LENGTH} characters or fewer.`;
    }
  }

  return null;
}

function mapCompanySettingsRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("company name is required")) {
    return "Company name is required.";
  }

  if (normalized.includes("currency code is required")) {
    return "Currency code is required.";
  }

  if (normalized.includes("timezone is required")) {
    return "Timezone is required.";
  }

  if (normalized.includes("company settings were not found")) {
    return "Company settings were not found.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("get_company_settings") ||
      normalized.includes("update_company_settings")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Company settings are not available yet. Apply the company settings database script and try again.";
  }

  return null;
}

function mapCompanySettingsError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapCompanySettingsRpcError(message) : null;
    },
  });
}

function mapCompanySettingsRpcResult(data: unknown): CompanySettings | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const id = row.id;
  const companyName = row.company_name;
  const currencyCode = row.currency_code;
  const timezone = row.timezone;
  const createdAt = row.created_at;
  const updatedAt = row.updated_at;

  if (typeof id !== "string" || !UUID_RE.test(id)) {
    return null;
  }

  if (typeof companyName !== "string" || companyName.trim().length === 0) {
    return null;
  }

  if (typeof currencyCode !== "string" || currencyCode.trim().length === 0) {
    return null;
  }

  if (typeof timezone !== "string" || timezone.trim().length === 0) {
    return null;
  }

  if (typeof createdAt !== "string" || typeof updatedAt !== "string") {
    return null;
  }

  const legalName = nullableString(row.legal_name);
  const vatNumber = nullableString(row.vat_number);
  const kvkNumber = nullableString(row.kvk_number);
  const address = nullableString(row.address);
  const postalCode = nullableString(row.postal_code);
  const city = nullableString(row.city);
  const country = nullableString(row.country);
  const phone = nullableString(row.phone);
  const email = nullableString(row.email);
  const website = nullableString(row.website);

  if (
    legalName === undefined ||
    vatNumber === undefined ||
    kvkNumber === undefined ||
    address === undefined ||
    postalCode === undefined ||
    city === undefined ||
    country === undefined ||
    phone === undefined ||
    email === undefined ||
    website === undefined
  ) {
    return null;
  }

  return {
    id,
    companyName,
    legalName,
    vatNumber,
    kvkNumber,
    address,
    postalCode,
    city,
    country,
    phone,
    email,
    website,
    currencyCode,
    timezone,
    createdAt,
    updatedAt,
  };
}

function rpcArg(
  value: string | null | undefined,
): string | null {
  return value === undefined ? null : value;
}

export const companySettingsService = {
  /**
   * Load the single company_settings row via get_company_settings RPC.
   */
  async getCompanySettings(): Promise<ServiceResult<CompanySettings>> {
    try {
      const { data, error } = await supabase.rpc("get_company_settings");

      if (error) {
        return fail(
          mapCompanySettingsError(error, "Failed to load company settings."),
        );
      }

      const rpcResult = mapCompanySettingsRpcResult(data);
      if (!rpcResult) {
        return fail("Company settings response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(
        mapCompanySettingsError(error, "Failed to load company settings."),
      );
    }
  },

  /**
   * Update the single company_settings row via update_company_settings RPC.
   */
  async updateCompanySettings(
    input: UpdateCompanySettingsInput,
  ): Promise<ServiceResult<CompanySettings>> {
    try {
      const validationError = validateUpdateCompanySettingsInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const { data, error } = await supabase.rpc("update_company_settings", {
        p_company_name: rpcArg(input.company_name),
        p_legal_name: rpcArg(input.legal_name),
        p_vat_number: rpcArg(input.vat_number),
        p_kvk_number: rpcArg(input.kvk_number),
        p_address: rpcArg(input.address),
        p_postal_code: rpcArg(input.postal_code),
        p_city: rpcArg(input.city),
        p_country: rpcArg(input.country),
        p_phone: rpcArg(input.phone),
        p_email: rpcArg(input.email),
        p_website: rpcArg(input.website),
        p_currency_code: rpcArg(input.currency_code),
        p_timezone: rpcArg(input.timezone),
      });

      if (error) {
        return fail(
          mapCompanySettingsError(error, "Failed to update company settings."),
        );
      }

      const rpcResult = mapCompanySettingsRpcResult(data);
      if (!rpcResult) {
        return fail("Company settings updated but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(
        mapCompanySettingsError(error, "Failed to update company settings."),
      );
    }
  },
};
