type DashboardInfoProps = {
  messages: string[];
};

/**
 * Informational state — partial availability (not an error).
 */
export function DashboardInfo({ messages }: DashboardInfoProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4"
      role="status"
      data-testid="dashboard-info"
    >
      <p className="text-sm font-semibold text-amber-950">
        A few details are still catching up
      </p>
      <ul className="mt-2 space-y-1.5 text-sm text-amber-900/90">
        {messages.map((message) => (
          <li key={message} className="flex gap-2">
            <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
            <span>{message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
