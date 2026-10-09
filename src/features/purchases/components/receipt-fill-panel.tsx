"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/money";
import { purchaseReceiptService } from "../services/purchase-receipt-service";
import {
  buildReceiptDraftLines,
  buildUnknownReceiptLine,
  type BuiltReceiptLine,
  type ReceiptDraftBuild,
  type ReceiptLineMatch,
} from "../utils/receipt-lines-to-draft";
import { requestReceiptRecognition } from "../utils/request-receipt-recognition";

interface ReceiptFillPanelProps {
  receiptId: string;
  /** Supplier currently chosen in the form; empty when none. */
  supplierId: string;
  knownIngredientIds: ReadonlySet<string>;
  disabled: boolean;
  onFill: (lines: BuiltReceiptLine[]) => void;
}

const NOT_CONFIGURED = "Receipt reading is not set up.";
const UNREADABLE = "The photo could not be read. Enter the lines by hand.";
const MATCH_FAILED = "Could not load remembered lines.";

async function loadMatches(
  supplierId: string,
  texts: string[],
): Promise<{ matches: ReceiptLineMatch[]; failed: boolean }> {
  if (!supplierId) {
    return { matches: [], failed: false };
  }
  try {
    const result = await purchaseReceiptService.matchReceiptLines(supplierId, texts);
    return result.error || !result.data
      ? { matches: [], failed: true }
      : { matches: result.data, failed: false };
  } catch {
    return { matches: [], failed: true };
  }
}

export function ReceiptFillPanel({
  receiptId,
  supplierId,
  knownIngredientIds,
  disabled,
  onFill,
}: ReceiptFillPanelProps) {
  const [reading, setReading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [matchWarning, setMatchWarning] = useState<string | null>(null);
  const [build, setBuild] = useState<ReceiptDraftBuild | null>(null);
  const [addedIndexes, setAddedIndexes] = useState<Set<number>>(() => new Set());

  async function fill() {
    setReading(true);
    setMessage(null);
    const recognition = await requestReceiptRecognition(receiptId);
    if (recognition.status === "not_configured") {
      setMessage(NOT_CONFIGURED);
      setReading(false);
      return;
    }
    if (recognition.status === "error") {
      setMessage(recognition.message);
      setReading(false);
      return;
    }
    if (!recognition.result.readable) {
      setMessage(UNREADABLE);
      setReading(false);
      return;
    }

    const { matches, failed } = await loadMatches(
      supplierId,
      recognition.result.lines.map((line) => line.text),
    );
    const built = buildReceiptDraftLines(recognition.result, matches, knownIngredientIds);
    setMatchWarning(failed ? MATCH_FAILED : null);
    setBuild(built);
    setReading(false);
    onFill(built.lines);
  }

  function addNotAdded(index: number) {
    const line = build?.notAdded[index];
    // A zero or negative amount would become a line that cannot be saved.
    if (!line || line.amount <= 0 || addedIndexes.has(index)) {
      return;
    }
    setAddedIndexes((current) => new Set(current).add(index));
    onFill([buildUnknownReceiptLine(line)]);
  }

  if (!build) {
    return (
      <div className="mt-3 space-y-2">
        <button
          type="button"
          onClick={() => void fill()}
          disabled={disabled || reading}
          className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {reading ? "Reading receipt… (10–20 s)" : "Fill lines from receipt"}
        </button>
        {message ? (
          <p role="alert" className="text-sm text-red-700">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  const { summary } = build;
  const summaryParts = [
    summary.receiptTotal === null ? null : `Receipt total ${formatMoney(summary.receiptTotal)}`,
    `added ${formatMoney(summary.addedTotal)}`,
    `not added ${formatMoney(summary.notAddedTotal)}`,
  ].filter((part): part is string => part !== null);
  const joined = summaryParts.join(" · ");
  const summaryText = `${joined.charAt(0).toUpperCase()}${joined.slice(1)}`;

  return (
    <div className="mt-3 space-y-2">
      <p className="font-medium">{summaryText}</p>
      {matchWarning ? <p className="text-sm text-amber-800">{matchWarning}</p> : null}
      {build.notAdded.length > 0 ? (
        <ul className="space-y-1" aria-label="Not added from receipt">
          {build.notAdded.map((line, index) => (
            <li
              key={`${index}-${line.text}`}
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span className="min-w-0 break-words">
                {line.text} · {formatMoney(line.amount)} · {line.reason}
              </span>
              {line.amount <= 0 ? null : addedIndexes.has(index) ? (
                <span className="text-xs text-amber-800">Added</span>
              ) : (
                <button
                  type="button"
                  onClick={() => addNotAdded(index)}
                  disabled={disabled}
                  aria-label={`Add ${line.text}`}
                  className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium text-amber-900 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Add
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
