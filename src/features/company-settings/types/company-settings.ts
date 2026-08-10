/**
 * Company Settings domain contracts (DEV-051).
 *
 * Read/write path: get_company_settings / update_company_settings RPCs.
 * Single-row configuration lives in SQL only. No auth/permissions.
 */

/**
 * Mapped company_settings row for service consumers.
 */
export interface CompanySettings {
  id: string;
  companyName: string;
  legalName: string | null;
  vatNumber: string | null;
  kvkNumber: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  currencyCode: string;
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * updateCompanySettings input.
 * Undefined fields are left unchanged by SQL.
 * Null / blank string clears nullable columns; company_name, currency_code,
 * and timezone cannot be cleared.
 */
export interface UpdateCompanySettingsInput {
  company_name?: string | null;
  legal_name?: string | null;
  vat_number?: string | null;
  kvk_number?: string | null;
  address?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  currency_code?: string | null;
  timezone?: string | null;
}

export type { ServiceResult } from "@/types/service";
