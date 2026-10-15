"use client";

import { useState } from "react";
import {
  NumericInput,
  formatNumericInput,
  parseNumericInput,
} from "@/components/ui/numeric-input";
import { formatDateTime } from "@/lib/date";
import {
  WRITE_OFF_REQUEST_ITEM_TYPE_LABELS,
  WRITE_OFF_REQUEST_NOTE_MAX_LENGTH,
  type WriteOffRequest,
} from "../types/write-off-request";
import {
  formatRequestQuantity,
  requestItemName,
  requestReasonLabel,
} from "../utils/format-write-off-request";

type WriteOffRequestQueueProps = {
  items: WriteOffRequest[];
  busyId: string | null;
  rowErrors: Readonly<Record<string, string>>;
  onApprove: (id: string, quantity: number | null) => Promise<boolean>;
  onReject: (id: string, note: string | null) => Promise<boolean>;
};

const inputClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20";

function QueueRow({
  request,
  busy,
  error,
  onApprove,
  onReject,
}: {
  request: WriteOffRequest;
  busy: boolean;
  error: string | null;
  onApprove: (id: string, quantity: number | null) => Promise<boolean>;
  onReject: (id: string, note: string | null) => Promise<boolean>;
}) {
  const [quantity, setQuantity] = useState(formatNumericInput(request.quantity));
  const [rejectNote, setRejectNote] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const approve = () => {
    const parsed = parseNumericInput(quantity);
    if (parsed === null || parsed <= 0) {
      setLocalError("Enter a quantity greater than zero.");
      return;
    }
    setLocalError(null);
    // Unchanged quantity → approve as requested (null).
    void onApprove(request.id, parsed === request.quantity ? null : parsed);
  };

  const reject = () => {
    setLocalError(null);
    void onReject(request.id, rejectNote.trim() ? rejectNote.trim() : null);
  };

  const shownError = localError ?? error;

  return (
    <li
      className="space-y-3 px-4 py-4"
      data-testid={`write-off-request-pending-${request.id}`}
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-zinc-900">
            {requestItemName(request)}{" "}
            <span className="font-normal text-zinc-600">
              · {formatRequestQuantity(request.quantity, request.unit)}
            </span>
          </p>
          <p className="text-sm text-zinc-500">
            {WRITE_OFF_REQUEST_ITEM_TYPE_LABELS[request.item_type]} ·{" "}
            {requestReasonLabel(request)}
          </p>
          {request.note ? (
            <p className="text-sm text-zinc-700">{request.note}</p>
          ) : null}
        </div>
        <span className="shrink-0 text-xs text-zinc-500">
          {formatDateTime(request.requested_at)}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_auto_minmax(0,1fr)_auto] sm:items-end">
        <div className="space-y-1">
          <label
            htmlFor={`approve-quantity-${request.id}`}
            className="block text-xs font-medium text-zinc-600"
          >
            Quantity{request.unit ? ` (${request.unit})` : ""}
          </label>
          <NumericInput
            id={`approve-quantity-${request.id}`}
            value={quantity}
            onChange={setQuantity}
            disabled={busy}
          />
        </div>
        <button
          type="button"
          onClick={approve}
          disabled={busy}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {busy ? "Saving…" : "Approve"}
        </button>
        <div className="space-y-1">
          <label
            htmlFor={`reject-note-${request.id}`}
            className="block text-xs font-medium text-zinc-600"
          >
            Reject note (optional)
          </label>
          <input
            id={`reject-note-${request.id}`}
            type="text"
            value={rejectNote}
            maxLength={WRITE_OFF_REQUEST_NOTE_MAX_LENGTH}
            onChange={(event) => setRejectNote(event.target.value)}
            disabled={busy}
            className={inputClassName}
          />
        </div>
        <button
          type="button"
          onClick={reject}
          disabled={busy}
          className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:text-zinc-400"
        >
          Reject
        </button>
      </div>

      {shownError ? (
        <p
          role="alert"
          className="text-sm text-red-600"
          data-testid={`write-off-request-error-${request.id}`}
        >
          {shownError}
        </p>
      ) : null}
    </li>
  );
}

/** Owner/partner queue of pending requests with Approve / Reject per row. */
export function WriteOffRequestQueue({
  items,
  busyId,
  rowErrors,
  onApprove,
  onReject,
}: WriteOffRequestQueueProps) {
  return (
    <section
      className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
      data-testid="write-off-request-queue"
    >
      <h2 className="border-b border-zinc-200 px-4 py-3 text-base font-semibold text-zinc-900">
        Pending
      </h2>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-zinc-500">
          No pending write-off requests.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {items.map((request) => (
            <QueueRow
              key={request.id}
              request={request}
              busy={busyId === request.id}
              error={rowErrors[request.id] ?? null}
              onApprove={onApprove}
              onReject={onReject}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
