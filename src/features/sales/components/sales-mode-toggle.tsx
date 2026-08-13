import Link from "next/link";

type SalesModeToggleProps = {
  active: "draft" | "quick";
};

function tabClassName(isActive: boolean): string {
  return `rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
    isActive
      ? "bg-white text-zinc-900 shadow-sm"
      : "text-zinc-600 hover:text-zinc-900"
  }`;
}

/** Segmented-control-style switch between the two /sales entry points. */
export function SalesModeToggle({ active }: SalesModeToggleProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-zinc-100 p-1">
      <Link href="/sales" className={tabClassName(active === "draft")}>
        Draft Sale
      </Link>
      <Link href="/sales/quick" className={tabClassName(active === "quick")}>
        Quick Sale
      </Link>
    </div>
  );
}
