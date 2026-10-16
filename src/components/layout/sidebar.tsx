"use client";

import Link from "next/link";
import { usePendingWriteOffRequestCount } from "@/features/write-off-requests/hooks/use-pending-write-off-request-count";
import { useRole } from "@/hooks/use-role";
import { isNavItemVisible, navItems, type NavItemCounter } from "@/lib/navigation";
import { canSeeCosts } from "@/lib/roles";

type SidebarProps = {
  isOpen: boolean;
  onClose: () => void;
  activePath?: string;
};

export function Sidebar({ isOpen, onClose, activePath = "/" }: SidebarProps) {
  const { role } = useRole();
  const visibleItems = navItems.filter((item) => isNavItemVisible(item, role));
  // Counters are owner/partner only; for a seller nothing is read.
  const pendingWriteOffRequests = usePendingWriteOffRequestCount(canSeeCosts(role));
  const counters: Record<NavItemCounter, number> = {
    pendingWriteOffRequests,
  };

  return (
    <>
      {isOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-zinc-900/50 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-zinc-800 bg-zinc-900 transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center border-b border-zinc-800 px-6">
          <span className="text-lg font-semibold tracking-tight text-white">
            Crepe&apos;n Roll
          </span>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {visibleItems.map((item) => {
              const isActive =
                item.href !== "#" && item.href === activePath;

              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    aria-current={isActive ? "page" : undefined}
                    className={`block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-amber-500/15 text-amber-400"
                        : "text-zinc-300 hover:bg-zinc-800 hover:text-white"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span>{item.label}</span>
                      {item.counter && counters[item.counter] > 0 ? (
                        <span
                          className="inline-flex min-w-6 justify-center rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white"
                          data-testid={`nav-counter-${item.counter}`}
                          aria-label={`${counters[item.counter]} pending`}
                        >
                          {counters[item.counter]}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>
    </>
  );
}
