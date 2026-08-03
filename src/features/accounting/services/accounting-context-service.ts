/**
 * Accounting Context service.
 *
 * Assembles the shared inputs both ProductionAccountingContext
 * (production-execution) and SaleAccountingContext (sales) need to
 * propose/post a journal:
 *   - the currently open fiscal period covering today
 *   - every active account_role_bindings row
 *   - the company's currency (Company Settings)
 *
 * Single-currency assumption, confirmed by inspection (no currency column
 * anywhere on sales / sale_lines / production_batches, no exchange-rate
 * handling anywhere in Sales or Production Execution outside this generic
 * Accounting integration layer): baseCurrency === transactionCurrency ===
 * company_settings.currency_code, exchangeRate is always 1. Revisit this
 * service if/when a real multi-currency transaction path is introduced.
 *
 * Fails clearly instead of defaulting silently: no open fiscal period, no
 * account role bindings, or unreadable company settings all reject rather
 * than posting with guessed values.
 *
 * Deliberately left unset (not forgotten): AccountingContextFields does not
 * populate accountsById or alreadyPostedIdempotencyKeys, both optional on
 * ProductionAccountingContext / SaleAccountingContext. Each only drives an
 * early, best-effort pre-check (posting-pipeline.ts's account.is_active /
 * is_postable check, and assertNotDuplicate's in-memory duplicate check) —
 * both silently no-op when omitted. Real enforcement happens later in
 * posting-service.ts against a fresh DB read regardless of what this
 * context supplies: validateAccountsForPosting re-loads accounts by id
 * before persisting, and findExistingPostedJournal re-checks
 * journal_entries.business_event_id for an existing posted row. Omitting
 * both fields here only forgoes an earlier, friendlier rejection — it does
 * not weaken the actual guarantee.
 */

import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type { AccountRoleBinding, FiscalPeriod } from "@/types/accounting";
import { companySettingsService } from "@/features/company-settings/services/company-settings-service";

/**
 * Common fields required by both ProductionAccountingContext and
 * SaleAccountingContext (their required fields are identical; the
 * remaining fields on each are optional and feature-specific).
 */
export interface AccountingContextFields {
  fiscalPeriod: FiscalPeriod;
  accountRoleBindings: readonly AccountRoleBinding[];
  baseCurrency: string;
  transactionCurrency: string;
  exchangeRate: number;
  rateDate: string;
}

async function loadOpenFiscalPeriodForToday(
  today: string,
): Promise<ServiceResult<FiscalPeriod>> {
  const { data, error } = await supabase
    .from("fiscal_periods")
    .select(
      "id, name, start_date, end_date, status, closed_at, created_at, updated_at",
    )
    .eq("status", "open")
    .lte("start_date", today)
    .gte("end_date", today)
    .maybeSingle();

  if (error) {
    return fail(toUserError(error, "Failed to load the open fiscal period"));
  }

  if (!data) {
    return fail(
      "No open fiscal period covers today's date. Ask an administrator to open a fiscal period before posting.",
    );
  }

  return ok(data as FiscalPeriod);
}

async function loadActiveAccountRoleBindings(): Promise<
  ServiceResult<readonly AccountRoleBinding[]>
> {
  const { data, error } = await supabase
    .from("account_role_bindings")
    .select(
      "id, role, account_id, effective_from, effective_to, is_active, created_at",
    )
    .eq("is_active", true);

  if (error) {
    return fail(toUserError(error, "Failed to load account role bindings"));
  }

  return ok((data as AccountRoleBinding[] | null) ?? []);
}

export const accountingContextService = {
  /**
   * Builds the shared accounting context needed to post a journal today.
   */
  async getCurrentAccountingContext(): Promise<
    ServiceResult<AccountingContextFields>
  > {
    const today = new Date().toISOString().slice(0, 10);

    const [fiscalPeriodResult, bindingsResult, companySettingsResult] =
      await Promise.all([
        loadOpenFiscalPeriodForToday(today),
        loadActiveAccountRoleBindings(),
        companySettingsService.getCompanySettings(),
      ]);

    if (fiscalPeriodResult.error || !fiscalPeriodResult.data) {
      return fail(fiscalPeriodResult.error ?? "Failed to load fiscal period");
    }

    if (bindingsResult.error || !bindingsResult.data) {
      return fail(
        bindingsResult.error ?? "Failed to load account role bindings",
      );
    }

    if (companySettingsResult.error || !companySettingsResult.data) {
      return fail(
        companySettingsResult.error ?? "Failed to load company settings",
      );
    }

    const currencyCode = companySettingsResult.data.currencyCode;

    return ok({
      fiscalPeriod: fiscalPeriodResult.data,
      accountRoleBindings: bindingsResult.data,
      baseCurrency: currencyCode,
      transactionCurrency: currencyCode,
      exchangeRate: 1,
      rateDate: today,
    });
  },
};
