export const POS_TABS = ["sale", "queue", "shift", "history", "stock"] as const;

export type PosTab = (typeof POS_TABS)[number];

const TAB_LABELS: Record<PosTab, string> = {
  sale: "Sale",
  queue: "Queue",
  shift: "Shift",
  history: "History",
  stock: "Stock",
};

export function parsePosTab(value: string | null): PosTab {
  if (
    value === "queue" ||
    value === "shift" ||
    value === "history" ||
    value === "stock"
  ) {
    return value;
  }

  return "sale";
}

type PosTabNavProps = {
  activeTab: PosTab;
  onTabChange: (tab: PosTab) => void;
  queueCount?: number;
};

export function PosTabNav({
  activeTab,
  onTabChange,
  queueCount = 0,
}: PosTabNavProps) {
  return (
    <nav
      aria-label="POS sections"
      className="border-t border-zinc-200 bg-white px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
    >
      <ul className="grid grid-cols-5 gap-1">
        {POS_TABS.map((tab) => {
          const isActive = tab === activeTab;

          return (
            <li key={tab}>
              <button
                type="button"
                onClick={() => onTabChange(tab)}
                aria-current={isActive ? "page" : undefined}
                className={`flex min-h-14 w-full items-center justify-center gap-1.5 rounded-xl px-2 text-base font-semibold transition-colors ${
                  isActive
                    ? "bg-amber-500 text-white"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
                }`}
              >
                {TAB_LABELS[tab]}
                {tab === "queue" && queueCount > 0 ? (
                  <span
                    className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold ${
                      isActive
                        ? "bg-white text-amber-600"
                        : "bg-amber-500 text-white"
                    }`}
                  >
                    {queueCount}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
