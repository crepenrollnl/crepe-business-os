"use client";

import { useState, type ReactNode } from "react";

type CollapsibleWorkspaceCardProps = {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function CollapsibleWorkspaceCard({
  title,
  description,
  defaultOpen = true,
  children,
}: CollapsibleWorkspaceCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-start justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-4 text-left transition-colors hover:bg-zinc-100/80"
      >
        <div>
          <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-sm text-zinc-500">{description}</p>
          ) : null}
        </div>
        <span
          aria-hidden
          className={`mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-600 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className="h-4 w-4"
            aria-hidden
          >
            <path
              d="M5 7.5L10 12.5L15 7.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {open ? <div>{children}</div> : null}
    </div>
  );
}
