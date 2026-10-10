/**
 * Write-off → Accounting integration.
 *
 * record_write_off (sql/115) and record_dish_write_off (sql/136) own stock.
 * After they succeed, this service emits waste_recognized and posts via
 * post_journal_proposals — same pattern as confirmSaleAndPostJournals: a
 * posting failure never undoes the physical write-off.
 *
 * - A single write-off posts one journal for its row.
 * - A dish write-off posts at most one journal per item type ("ingredient",
 *   then "finished_good"): the rows' values are summed first and rounded
 *   once, same as sale COGS. Per-row journals would round sub-cent parts
 *   (e.g. a pinch of salt) to 0.00 and fail with no posting lines.
 * - An amount that rounds to 0.00 is not posted and not reported as a
 *   failure: there is nothing to put in the ledger.
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
import { roundMoney } from "@/lib/money";
import { fail, ok, type ServiceResult } from "@/types/service";
import {
  WRITE_OFF_BELOW_ONE_CENT_ACCOUNTING_NOTE,
  WRITE_OFF_ITEM_TYPES,
  WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE,
  type RecordDishWriteOffAndPostResult,
  type RecordDishWriteOffInput,
  type RecordWriteOffAndPostResult,
  type RecordWriteOffInput,
  type RecordWriteOffRpcResult,
  type WriteOffItemType,
} from "../types/write-off";
import { reportPostingFailure } from "@/features/accounting/utils/report-posting-failure";
import { writeOffService } from "./write-off-service";

const CONTEXT_UNAVAILABLE =
  "Write-off recorded but accounting context is unavailable.";

/** write_offs.total_value is numeric(12,4): sum in whole ten-thousandths. */
const TOTAL_VALUE_SCALE = 10_000;

interface WriteOffJournalInput {
  documentId: string;
  itemType: WriteOffItemType;
  amount: number;
  idempotencyKey: string;
  /** write_offs rows a failure is reported against (all parts of a group). */
  reportEntityIds: string[];
  extraTags?: Readonly<Record<string, string>>;
}

interface DishWriteOffGroup {
  itemType: WriteOffItemType;
  rows: RecordWriteOffRpcResult[];
  amount: number;
}

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

function reportWriteOffPostingFailures(
  writeOffIds: readonly string[],
  errorMessage: string,
  businessEventId?: string | null,
): void {
  for (const writeOffId of writeOffIds) {
    reportWriteOffPostingFailure(writeOffId, errorMessage, businessEventId);
  }
}

function writeOffIdempotencyKey(writeOffId: string): string {
  return `waste_recognized:${writeOffId}`;
}

function dishWriteOffIdempotencyKey(
  itemType: WriteOffItemType,
  firstWriteOffId: string,
): string {
  return `waste_recognized:dish:${itemType}:${firstWriteOffId}`;
}

/** True when the pipeline would round the amount to 0.00 and post no lines. */
function isBelowOneCent(amount: number): boolean {
  return roundMoney(amount) === 0;
}

function sumTotalValues(rows: readonly RecordWriteOffRpcResult[]): number {
  const scaled = rows.reduce(
    (sum, row) => sum + Math.round(row.total_value * TOTAL_VALUE_SCALE),
    0,
  );
  return scaled / TOTAL_VALUE_SCALE;
}

/** Groups rows by item type in WRITE_OFF_ITEM_TYPES order, keeping RPC order inside a group. */
function groupDishWriteOffRows(
  rows: readonly RecordWriteOffRpcResult[],
): DishWriteOffGroup[] {
  const groups: DishWriteOffGroup[] = [];
  for (const itemType of WRITE_OFF_ITEM_TYPES) {
    const groupRows = rows.filter((row) => row.item_type === itemType);
    if (groupRows.length > 0) {
      groups.push({ itemType, rows: groupRows, amount: sumTotalValues(groupRows) });
    }
  }
  return groups;
}

/**
 * Posts one waste_recognized journal with an already loaded accounting
 * context. Returns the posting error, or null when posted. Every failure is
 * reported once per id in reportEntityIds; nothing here touches stock.
 */
async function postWriteOffJournal(
  journal: WriteOffJournalInput,
  context: AccountingContextFields,
): Promise<string | null> {
  const eventResult = createBusinessEvent({
    event_type: "waste_recognized",
    source_module: "write_offs",
    source_document_type: "write_off",
    source_document_id: journal.documentId,
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
      other_amount: journal.amount,
    },
    idempotency_key: journal.idempotencyKey,
  });

  if (eventResult.error || !eventResult.data) {
    const postingError =
      eventResult.error ??
      "Write-off recorded but the accounting event could not be built.";
    reportWriteOffPostingFailures(journal.reportEntityIds, postingError);
    return postingError;
  }

  const posted = await operationalAccountingIntegrationService.post({
    event: eventResult.data,
    metadata: createPostingMetadata({
      event: eventResult.data,
      requested_at: new Date().toISOString(),
      correlation_id: journal.documentId,
      tags: {
        ...journal.extraTags,
        module: "write_offs",
        document: "write_off",
        item_type: journal.itemType,
      },
    }),
    context: {
      fiscalPeriod: context.fiscalPeriod,
      accountRoleBindings: context.accountRoleBindings,
      postingRules: [createWriteOffPostingRule(journal.itemType)],
    },
    mode: "post",
  });

  if (posted.error || !posted.data) {
    const postingError =
      posted.error ??
      "Write-off recorded but accounting posting failed.";
    reportWriteOffPostingFailures(
      journal.reportEntityIds,
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

    if (isBelowOneCent(writeOff.total_value)) {
      return ok({
        writeOff,
        postingError: null,
        accountingNote: WRITE_OFF_BELOW_ONE_CENT_ACCOUNTING_NOTE,
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

    const postingError = await postWriteOffJournal(
      {
        documentId: writeOff.id,
        itemType: writeOff.item_type,
        amount: writeOff.total_value,
        idempotencyKey: writeOffIdempotencyKey(writeOff.id),
        reportEntityIds: [writeOff.id],
      },
      context.data,
    );
    return ok({ writeOff, postingError, accountingNote: null });
  },

  /**
   * Writes off a dish as its parts (one transaction in the database), then
   * posts one journal per item type for the summed value of its parts. A
   * failing group's journal never stops the other and never undoes the
   * stock change.
   */
  async recordDishWriteOffAndPost(
    input: RecordDishWriteOffInput,
  ): Promise<ServiceResult<RecordDishWriteOffAndPostResult>> {
    const recorded = await writeOffService.recordDishWriteOff(input);
    if (recorded.error || !recorded.data) {
      return fail(recorded.error ?? "Failed to record dish write-off.");
    }

    const dishWriteOff = recorded.data;
    const postable = groupDishWriteOffRows(dishWriteOff.write_offs).filter(
      (group) => !isBelowOneCent(group.amount),
    );

    if (postable.length === 0) {
      return ok({
        dishWriteOff,
        postingErrors: [],
        accountingNote: WRITE_OFF_ZERO_COST_ACCOUNTING_NOTE,
      });
    }

    const context = await accountingContextService.getCurrentAccountingContext();
    if (context.error || !context.data) {
      const postingError = context.error ?? CONTEXT_UNAVAILABLE;
      for (const group of postable) {
        reportWriteOffPostingFailures(
          group.rows.map((row) => row.id),
          postingError,
        );
      }
      return ok({ dishWriteOff, postingErrors: [postingError], accountingNote: null });
    }

    const postingErrors: string[] = [];
    for (const group of postable) {
      const firstRowId = group.rows[0].id;
      const postingError = await postWriteOffJournal(
        {
          documentId: firstRowId,
          itemType: group.itemType,
          amount: group.amount,
          idempotencyKey: dishWriteOffIdempotencyKey(group.itemType, firstRowId),
          reportEntityIds: group.rows.map((row) => row.id),
          extraTags: {
            dish_product_id: dishWriteOff.product_id,
            part_count: String(group.rows.length),
          },
        },
        context.data,
      );
      if (postingError && !postingErrors.includes(postingError)) {
        postingErrors.push(postingError);
      }
    }

    return ok({ dishWriteOff, postingErrors, accountingNote: null });
  },
};
