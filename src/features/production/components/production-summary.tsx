import type { ProductionPlanSummary } from "../types/production";

type ProductionSummaryProps = {
  summary: ProductionPlanSummary;
};

function formatPlanningStatus(status: ProductionPlanSummary["planning_status"]) {
  switch (status) {
    case "draft":
      return "Draft";
    case "waiting_for_purchases":
      return "Waiting for Purchases";
    case "ready_to_produce":
      return "Ready to Produce";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

function formatShoppingStatus(
  status: ProductionPlanSummary["shopping_list_status"],
) {
  return status === "generated" ? "Generated" : "Not Generated";
}

function formatPurchaseDraftStatus(
  status: ProductionPlanSummary["purchase_draft_status"],
) {
  switch (status) {
    case "draft_created":
      return "Draft Created";
    case "completed":
      return "Completed";
    default:
      return "Not Created";
  }
}

export function ProductionSummary({ summary }: ProductionSummaryProps) {
  const cards = [
    {
      label: "Planned Products",
      value: String(summary.planned_product_count),
    },
    {
      label: "Ingredient Lines",
      value: String(summary.total_ingredient_lines),
    },
    {
      label: "Missing Ingredients",
      value: String(summary.missing_ingredient_lines),
    },
    {
      label: "Shopping List",
      value: formatShoppingStatus(summary.shopping_list_status),
    },
    {
      label: "Purchase Draft",
      value: formatPurchaseDraftStatus(summary.purchase_draft_status),
    },
    {
      label: "Planning Status",
      value: formatPlanningStatus(summary.planning_status),
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-zinc-200 bg-zinc-50/70 px-4 py-3"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            {card.label}
          </p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}
