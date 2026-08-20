"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { LogoutButton } from "@/components/logout-button";
import { PosTabNav, type PosTab } from "./pos-tab-nav";

type PosShellProps = {
  activeTab: PosTab;
  onTabChange: (tab: PosTab) => void;
  queueCount?: number;
  children: ReactNode;
};

export function PosShell({
  activeTab,
  onTabChange,
  queueCount = 0,
  children,
}: PosShellProps) {
  return (
    <div className="flex h-dvh flex-col bg-zinc-50">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-tight text-zinc-900">
            POS
          </p>
          <Link
            href="/"
            className="text-sm font-medium text-amber-700 hover:text-amber-800"
          >
            Back to OS
          </Link>
        </div>

        <LogoutButton />
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {children}
      </main>

      <PosTabNav
        activeTab={activeTab}
        onTabChange={onTabChange}
        queueCount={queueCount}
      />
    </div>
  );
}
