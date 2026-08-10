type ProductionExecutionSummaryPlaceholderProps = {
  hasOpenSession: boolean;
  hasCompletedSession: boolean;
};

export function ProductionExecutionSummaryPlaceholder({
  hasOpenSession,
  hasCompletedSession,
}: ProductionExecutionSummaryPlaceholderProps) {
  let title = "Execution not started";
  let body =
    "Start Production to create a Production Session and record actual produced quantities. Finishing production consumes ingredients and creates finished-goods batches.";

  if (hasOpenSession) {
    title = "Production session in progress";
    body =
      "Open the active session to enter actual produced quantities and finish production.";
  } else if (hasCompletedSession) {
    title = "Production session completed";
    body =
      "Raw materials were consumed, production batches were created, and finished goods are available for sales.";
  }

  return (
    <div className="overflow-hidden rounded-xl border border-dashed border-zinc-300 bg-zinc-50/60 shadow-sm">
      <div className="border-b border-zinc-200 px-4 py-4">
        <h2 className="text-base font-semibold text-zinc-900">
          Execution Summary
        </h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Production sessions record planned vs actual output.
        </p>
      </div>
      <div className="px-4 py-12 text-center">
        <p className="text-sm font-medium text-zinc-900">{title}</p>
        <p className="mt-1 text-sm text-zinc-500">{body}</p>
      </div>
    </div>
  );
}
