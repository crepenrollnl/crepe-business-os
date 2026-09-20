"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/date";
import {
  POSTING_FAILURE_SOURCE_FLOW_LABELS,
  type PostingFailure,
} from "../types/posting-failure";

interface PostingFailuresListProps {
  items: PostingFailure[];
  loading: boolean;
  error: string | null;
  resolvingId: string | null;
  actionError: string | null;
  onRetry: () => void;
  onResolve: (id: string, note: string) => Promise<boolean>;
}

function PostingFailuresSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <tr key={index} className="border-t border-zinc-200">
          {Array.from({ length: 5 }).map((__, cellIndex) => (
            <td key={cellIndex} className="px-4 py-4">
              <div className="h-4 animate-pulse rounded bg-zinc-200" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function PostingFailureRow({
  item,
  resolving,
  onResolve,
}: {
  item: PostingFailure;
  resolving: boolean;
  onResolve: (id: string, note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");

  return (
    <tr className="border-t border-zinc-200 align-top">
      <td className="px-4 py-4 text-sm text-zinc-700">
        {formatDateTime(item.occurredAt)}
      </td>
      <td className="px-4 py-4 text-sm text-zinc-900">
        {POSTING_FAILURE_SOURCE_FLOW_LABELS[item.sourceFlow]}
        <div className="mt-0.5 text-xs text-zinc-500">
          {item.entityType} · {item.entityId}
        </div>
      </td>
      <td className="px-4 py-4 text-sm text-amber-800">{item.errorMessage}</td>
      <td className="px-4 py-4">
        <label className="sr-only" htmlFor={`resolution-note-${item.id}`}>
          Resolution note for {item.id}
        </label>
        <input
          id={`resolution-note-${item.id}`}
          type="text"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional note"
          disabled={resolving}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none"
        />
      </td>
      <td className="px-4 py-4 text-right">
        <button
          type="button"
          disabled={resolving}
          onClick={() => {
            void onResolve(item.id, note);
          }}
          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {resolving ? "Saving…" : "Mark resolved"}
        </button>
      </td>
    </tr>
  );
}

export function PostingFailuresList({
  items,
  loading,
  error,
  resolvingId,
  actionError,
  onRetry,
  onResolve,
}: PostingFailuresListProps) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="text-base font-medium text-red-800">
          Failed to load posting failures
        </p>
        <p className="mt-2 text-sm text-red-600">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      {actionError ? (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {actionError}
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
          <thead className="bg-zinc-50 text-xs font-medium uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">When</th>
              <th className="px-4 py-3">Flow</th>
              <th className="px-4 py-3">Error</th>
              <th className="px-4 py-3">Note</th>
              <th className="px-4 py-3">
                <span className="sr-only">Resolve</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <PostingFailuresSkeleton />
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-16 text-center">
                  <p className="text-base font-medium text-zinc-900">
                    No unresolved posting failures
                  </p>
                  <p className="mt-2 text-sm text-zinc-500">
                    Accounting journals that fail after a completed purchase,
                    sale, production, or write-off will appear here.
                  </p>
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <PostingFailureRow
                  key={item.id}
                  item={item}
                  resolving={resolvingId === item.id}
                  onResolve={onResolve}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
