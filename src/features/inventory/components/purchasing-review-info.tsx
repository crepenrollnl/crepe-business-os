type PurchasingReviewInfoProps = {
  messages: string[];
};

/**
 * Informational states for missing advisory services.
 * Presentational only — does not invent missing values.
 */
export function PurchasingReviewInfo({ messages }: PurchasingReviewInfoProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div
      className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3"
      role="status"
      data-testid="purchasing-review-info"
    >
      <p className="text-sm font-semibold text-sky-900">Purchasing review</p>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-sky-800">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  );
}
