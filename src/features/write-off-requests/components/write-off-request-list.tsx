import { formatDateTime } from "@/lib/date";
import {
  WRITE_OFF_REQUEST_ITEM_TYPE_LABELS,
  type WriteOffRequest,
} from "../types/write-off-request";
import {
  correctedQuantity,
  formatRequestQuantity,
  requestItemName,
  requestReasonLabel,
} from "../utils/format-write-off-request";

type WriteOffRequestListProps = {
  title: string;
  items: WriteOffRequest[];
  emptyText: string;
  /** Show the item type (owner/partner history). */
  showType?: boolean;
  testId?: string;
};

export function WriteOffRequestStatusPill({ request }: { request: WriteOffRequest }) {
  if (request.status === "pending") {
    return (
      <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
        Pending
      </span>
    );
  }
  if (request.status === "approved") {
    const corrected = correctedQuantity(request);
    return (
      <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">
        Approved
        {corrected !== null
          ? ` (${formatRequestQuantity(corrected, request.unit)})`
          : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
      Rejected
    </span>
  );
}

/** Requests with their status — quantities and names only, no costs. */
export function WriteOffRequestList({
  title,
  items,
  emptyText,
  showType = false,
  testId,
}: WriteOffRequestListProps) {
  return (
    <section
      className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm"
      data-testid={testId}
    >
      <h2 className="border-b border-zinc-200 px-4 py-3 text-base font-semibold text-zinc-900">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-zinc-500">{emptyText}</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {items.map((request) => (
            <li
              key={request.id}
              className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
              data-testid={`write-off-request-${request.id}`}
            >
              <div className="min-w-0">
                <p className="font-medium text-zinc-900">
                  {requestItemName(request)}{" "}
                  <span className="font-normal text-zinc-600">
                    · {formatRequestQuantity(request.quantity, request.unit)}
                  </span>
                </p>
                <p className="text-sm text-zinc-500">
                  {showType
                    ? `${WRITE_OFF_REQUEST_ITEM_TYPE_LABELS[request.item_type]} · `
                    : ""}
                  {requestReasonLabel(request)}
                  {request.note ? ` · ${request.note}` : ""}
                </p>
                {request.status === "rejected" && request.decision_note ? (
                  <p className="text-sm text-red-700">{request.decision_note}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
                <WriteOffRequestStatusPill request={request} />
                <span className="text-xs text-zinc-500">
                  {formatDateTime(request.decided_at ?? request.requested_at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
