/**
 * Write-off → Accounting integration.
 *
 * record_write_off (sql/115) owns stock. After it succeeds, this service
 * emits waste_recognized and posts via post_journal_proposals — same
 * pattern as confirmSaleAndPostJournals: a posting failure never undoes
 * the physical write-off.
 */

import { accountingContextService } from "@/features/accounting/services/accounting-context-service";
import { operationalAccountingIntegrationService } from "@/features/accounting/services/operational-accounting-integration-service";
import { createWriteOffPostingRule } from "@/features/accounting/rules/write-off-posting-rule";
import {
  createBusinessEvent,
  createPostingMetadata,
} from "@/features/accounting/utils/business-event-factory";
import { fail, ok, type ServiceResult } from "@/types/service";
import {
  WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE,
  type RecordWriteOffAndPostResult,
  type RecordWriteOffInput,
} from "../types/write-off";
import { writeOffService } from "./write-off-service";

function writeOffIdempotencyKey(writeOffId: string): string {
  return `waste_recognized:${writeOffId}`;
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
      return ok({
        writeOff,
        postingError:
          context.error ??
          "Write-off recorded but accounting context is unavailable.",
        accountingNote: null,
      });
    }

    const eventResult = createBusinessEvent({
      event_type: "waste_recognized",
      source_module: "write_offs",
      source_document_type: "write_off",
      source_document_id: writeOff.id,
      transaction_id: null,
      occurred_at: new Date().toISOString(),
      transaction_currency: context.data.transactionCurrency,
      base_currency: context.data.baseCurrency,
      exchange_rate: context.data.exchangeRate,
      rate_date: context.data.rateDate,
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
      return ok({
        writeOff,
        postingError:
          eventResult.error ??
          "Write-off recorded but the accounting event could not be built.",
        accountingNote: null,
      });
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
        fiscalPeriod: context.data.fiscalPeriod,
        accountRoleBindings: context.data.accountRoleBindings,
        postingRules: [createWriteOffPostingRule(writeOff.item_type)],
      },
      mode: "post",
    });

    if (posted.error || !posted.data) {
      return ok({
        writeOff,
        postingError:
          posted.error ??
          "Write-off recorded but accounting posting failed.",
        accountingNote: null,
      });
    }

    return ok({ writeOff, postingError: null, accountingNote: null });
  },
};
