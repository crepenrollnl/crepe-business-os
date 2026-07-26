type SearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  minQueryLength: number;
};

/**
 * Presentational global search input.
 */
export function SearchInput({
  value,
  onChange,
  onFocus,
  minQueryLength,
}: SearchInputProps) {
  return (
    <div className="relative w-full">
      <span
        className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-400"
        aria-hidden="true"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={onFocus}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
          }
        }}
        placeholder={`Search ERP… (min ${minQueryLength} characters)`}
        aria-label="Global search"
        autoComplete="off"
        className="block w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
      />
    </div>
  );
}
