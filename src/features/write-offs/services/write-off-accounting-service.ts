/**
 * Write-off → Accounting integration.
 *
 * record_write_off (sql/115) and record_dish_write_off (sql/136) own stock.
 * After they succeed, this service emits waste_recognized and posts via
 * post_journal_proposals, one journal per write-off row — same pattern as
 * confirmSaleAndPostJournals: a posting failure never undoes the physical
 * write-off.
 */

import {
  accountingContextService,
  type AccountingContextFields,
} from "@/features/accounting/services/accounting-context-service";
import { operationalAccountingIntegrationService } from "@/features/accounting/services/operational-accounting-integration-service";
import { createWriteOffPostingRule } from "@/features/accounting/rules/write-off-posting-rule";
import {
  createBusinessEvent,
  createPostingMetadata,
} from "@/features/accounting/utils/business-event-factory";
import { fail, ok, type ServiceResult } from "@/types/service";
import {
  WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE,
  type RecordDishWriteOffAndPostResult,
  type RecordDishWriteOffInput,
  type RecordWriteOffAndPostResult,
  type RecordWriteOffInput,
  type RecordWriteOffRpcResult,
} from "../types/write-off";
import { reportPostingFailure } from "@/features/accounting/utils/report-posting-failure";
import { writeOffService } from "./write-off-service";

const CONTEXT_UNAVAILABLE =
  "Write-off recorded but accounting context is unavailable.";

function reportWriteOffPostingFailure(
  writeOffId: string,
  errorMessage: string,
  businessEventId?: string | null,
): void {
  void reportPostingFailure({
    sourceFlow: "write_off_record",
    entityType: "write_off",
    entityId: writeOffId,
    businessEventId: businessEventId ?? null,
    errorMessage,
  });
}

function writeOffIdempotencyKey(writeOffId: string): string {
  return `waste_recognized:${writeOffId}`;
}

/**
 * Posts the waste_recognized journal for one write-off row with an already
 * loaded accounting context. Returns the posting error, or null when posted.
 * Every failure is reported; nothing here touches stock.
 */
async function postWriteOffJournal(
  writeOff: RecordWriteOffRpcResult,
  context: AccountingContextFields,
): Promise<string | null> {
  const eventResult = createBusinessEvent({
    event_type: "waste_recognized",
    source_module: "write_offs",
    source_document_type: "write_off",
    source_document_id: writeOff.id,
    transaction_id: null,
    occurred_at: new Date().toISOString(),
    transaction_currency: context.transactionCurrency,
    base_currency: context.baseCurrency,
    exchange_rate: context.exchangeRate,
    rate_date: context.rateDate,
    amounts: {
      gross_amount: null,
      net_amount: null,
      tax_amount: null,
      cogs_amount: null,
      discount_amount: null,
      shipping_amount: null,
      other_amount: writeOff.total_value,
    },
    idempotency_key: writeOffIdempotencyKey(writeOff.id),
  });

  if (eventResult.error || !eventResult.data) {
    const postingError =
      eventResult.error ??
      "Write-off recorded but the accounting event could not be built.";
    reportWriteOffPostingFailure(writeOff.id, postingError);
    return postingError;
  }

  const posted = await operationalAccountingIntegrationService.post({
    event: eventResult.data,
    metadata: createPostingMetadata({
      event: eventResult.data,
      requested_at: new Date().toISOString(),
      correlation_id: writeOff.id,
      tags: {
        module: "write_offs",
        document: "write_off",
        item_type: writeOff.item_type,
      },
    }),
    context: {
      fiscalPeriod: context.fiscalPeriod,
      accountRoleBindings: context.accountRoleBindings,
      postingRules: [createWriteOffPostingRule(writeOff.item_type)],
    },
    mode: "post",
  });

  if (posted.error || !posted.data) {
    const postingError =
      posted.error ??
      "Write-off recorded but accounting posting failed.";
    reportWriteOffPostingFailure(
      writeOff.id,
      postingError,
      eventResult.data.id,
    );
    return postingError;
  }

  return null;
}

export const writeOffAccountingService = {
  async recordWriteOffAndPost(
    input: RecordWriteOffInput,
  ): Promise<ServiceResult<RecordWriteOffAndPostResult>> {
    const recorded = await writeOffService.recordWriteOff(input);
    if (recorded.error || !recorded.data) {
      return fail(recorded.error ?? "Failed to record write-off.");
    }

    const writeOff = recorded.data;

    if (!(writeOff.total_value > 0)) {
      return ok({
        writeOff,
        postingError: null,
        accountingNote: WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE,
      });
    }

    const context = await accountingContextService.getCurrentAccountingContext();
    if (context.error || !context.data) {
      const postingError = context.error ?? CONTEXT_UNAVAILABLE;
      reportWriteOffPostingFailure(writeOff.id, postingError);
      return ok({
        writeOff,
        postingError,
        accountingNote: null,
      });
    }

    const postingError = await postWriteOffJournal(writeOff, context.data);
    return ok({ writeOff, postingError, accountingNote: null });
  },

  /**
   * Writes off a dish as its parts (one transaction in the database), then
   * posts one journal per part that carries a cost. A failing part's journal
   * never stops the others and never undoes the stock change.
   */
  async recordDishWriteOffAndPost(
    input: RecordDishWriteOffInput,
  ): Promise<ServiceResult<RecordDishWriteOffAndPostResult>> {
    const recorded = await writeOffService.recordDishWriteOff(input);
    if (recorded.error || !recorded.data) {
      return fail(recorded.error ?? "Failed to record dish write-off.");
    }

    const dishWriteOff = recorded.data;
    const costed = dishWriteOff.write_offs.filter((row) => row.total_value > 0);

    if (costed.length === 0) {
      return ok({
        dishWriteOff,
        postingErrors: [],
        accountingNote: WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE,
      });
    }

    const context = await accountingContextService.getCurrentAccountingContext();
    if (context.error || !context.data) {
      const postingError = context.error ?? CONTEXT_UNAVAILABLE;
      for (const row of costed) {
        reportWriteOffPostingFailure(row.id, postingError);
      }
      return ok({ dishWriteOff, postingErrors: [postingError], accountingNote: null });
    }

    const postingErrors: string[] = [];
    for (const row of costed) {
      const postingError = await postWriteOffJournal(row, context.data);
      if (postingError && !postingErrors.includes(postingError)) {
        postingErrors.push(postingError);
      }
    }

    return ok({ dishWriteOff, postingErrors, accountingNote: null });
  },
};
