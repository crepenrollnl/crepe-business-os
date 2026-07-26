import { UserAvatar } from "@/components/ui/user-avatar";
import { GlobalSearch } from "@/features/search/components/global-search";

type TopNavProps = {
  onMenuClick: () => void;
};

export function TopNav({ onMenuClick }: TopNavProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 sm:px-6 lg:px-8">
      <div className="flex shrink-0 items-center gap-4">
        <button
          type="button"
          aria-label="Open navigation menu"
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 lg:hidden"
          onClick={onMenuClick}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <line x1="4" x2="20" y1="6" y2="6" />
            <line x1="4" x2="20" y1="12" y2="12" />
            <line x1="4" x2="20" y1="18" y2="18" />
          </svg>
        </button>

        <h1 className="hidden text-lg font-semibold tracking-tight text-zinc-900 sm:block sm:text-xl">
          Crepe&apos;n Roll OS
        </h1>
      </div>

      <div className="min-w-0 flex-1 max-w-xl">
        <GlobalSearch />
      </div>

      <div className="shrink-0">
        <UserAvatar />
      </div>
    </header>
  );
}
