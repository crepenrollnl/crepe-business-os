import type { PurchasingReviewRow } from "../types/purchasing-review";
import type { IngredientWithRelations } from "../types/inventory";

type InventoryRowProps = {
  item: IngredientWithRelations;
  review?: PurchasingReviewRow | null;
  onEdit: (item: IngredientWithRelations) => void;
  onDelete: (item: IngredientWithRelations) => void;
};

type StockStatus = "ok" | "low" | "out";

function WarningIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-3.5 w-3.5"
    >
      <path
        fillRule="evenodd"
        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 10-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function getStockStatus(item: IngredientWithRelations): StockStatus {
  if (item.current_stock === 0) {
    return "out";
  }

  if (item.current_stock <= item.minimum_stock) {
    return "low";
  }

  return "ok";
}

function getRowClassName(status: StockStatus): string {
  if (status === "out") {
    return "border-red-200 bg-red-100/80 hover:bg-red-100";
  }

  if (status === "low") {
    return "border-amber-100 bg-amber-50/80 hover:bg-amber-50";
  }

  return "border-zinc-200 hover:bg-zinc-50";
}

function getStockBadgeClass(status: StockStatus): string {
  if (status === "out") {
    return "bg-red-200 text-red-800";
  }

  if (status === "low") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-green-100 text-green-700";
}

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function formatDaysRemaining(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return value.toFixed(1);
}

function formatPurchaseDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatPurchasePrice(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return `€${value.toFixed(2)}`;
}

function ForecastStatusLabel({
  review,
}: {
  review: PurchasingReviewRow | null | undefined;
}) {
  if (!review?.forecast_available || review.forecast_status === null) {
    return (
      <span className="text-zinc-500" data-testid="forecast-status">
        —
      </span>
    );
  }

  if (review.forecast_status === "healthy") {
    return (
      <span
        className="inline-flex items-center gap-1 text-emerald-700"
        data-testid="forecast-status"
      >
        <span aria-hidden="true">🟢</span> Healthy
      </span>
    );
  }

  if (review.forecast_status === "low") {
    return (
      <span
        className="inline-flex items-center gap-1 text-amber-700"
        data-testid="forecast-status"
      >
        <span aria-hidden="true">🟡</span> Low
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-red-700"
      data-testid="forecast-status"
    >
      <span aria-hidden="true">🔴</span> Critical
    </span>
  );
}

function RecommendationStatusLabel({
  review,
}: {
  review: PurchasingReviewRow | null | undefined;
}) {
  if (!review?.recommendation_available || !review.recommendation_status) {
    return (
      <span className="text-zinc-500" data-testid="recommendation-status">
        —
      </span>
    );
  }

  if (review.recommendation_status === "none") {
    return (
      <span className="text-zinc-500" data-testid="recommendation-status">
        None
      </span>
    );
  }

  if (review.recommendation_status === "urgent") {
    return (
      <span
        className="font-semibold text-red-700"
        data-testid="recommendation-status"
      >
        Urgent
      </span>
    );
  }

  return (
    <span
      className="font-semibold text-amber-700"
      data-testid="recommendation-status"
    >
      Recommended
    </span>
  );
}

function AlertLevelLabel({
  review,
}: {
  review: PurchasingReviewRow | null | undefined;
}) {
  if (!review?.alert_level) {
    return (
      <span className="text-zinc-500" data-testid="low-stock-alert-level">
        —
      </span>
    );
  }

  if (review.alert_level === "critical") {
    return (
      <span
        className="inline-flex items-center gap-1 font-semibold text-red-700"
        data-testid="low-stock-alert-level"
        title={review.alert_reason ?? undefined}
      >
        <span aria-hidden="true">🔴</span> Critical
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 font-semibold text-amber-700"
      data-testid="low-stock-alert-level"
      title={review.alert_reason ?? undefined}
    >
      <span aria-hidden="true">🟡</span> Low
    </span>
  );
}

export function InventoryRow({
  item,
  review = null,
  onEdit,
  onDelete,
}: InventoryRowProps) {
  const stockStatus = getStockStatus(item);
  const showWarning = stockStatus !== "ok";
  const currentQuantity = review?.current_quantity ?? item.current_stock;

  return (
    <tr className={`border-t transition-colors ${getRowClassName(stockStatus)}`}>
      <td className="px-4 py-4 font-medium text-zinc-900">{item.name}</td>
      <td className="px-4 py-4 text-zinc-600">{item.category?.name ?? "—"}</td>
      <td className="px-4 py-4 text-zinc-600">{item.supplier?.name ?? "—"}</td>
      <td className="px-4 py-4 text-zinc-600">{item.unit}</td>
      <td className="px-4 py-4 text-right">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${getStockBadgeClass(
            stockStatus,
          )}`}
          data-testid="current-quantity"
        >
          {showWarning && <WarningIcon />}
          {formatQuantity(currentQuantity)}
        </span>
      </td>
      <td
        className="px-4 py-4 text-right text-zinc-600"
        data-testid="avg-daily-usage"
      >
        {review?.average_daily_usage == null
          ? "—"
          : formatQuantity(review.average_daily_usage)}
      </td>
      <td className="px-4 py-4 text-right">
        <div className="inline-flex flex-col items-end gap-0.5">
          <span
            className="font-medium text-zinc-900"
            data-testid="days-remaining"
          >
            {formatDaysRemaining(review?.days_remaining)}
          </span>
          <ForecastStatusLabel review={review} />
        </div>
      </td>
      <td
        className="px-4 py-4 text-right font-medium text-zinc-900"
        data-testid="recommended-quantity"
      >
        {review?.suggested_order_quantity == null
          ? "—"
          : formatQuantity(review.suggested_order_quantity)}
      </td>
      <td
        className="px-4 py-4 text-right text-zinc-600"
        data-testid="target-stock"
      >
        {review?.target_stock == null
          ? "—"
          : formatQuantity(review.target_stock)}
      </td>
      <td className="px-4 py-4">
        <RecommendationStatusLabel review={review} />
      </td>
      <td
        className="max-w-[14rem] px-4 py-4 text-sm text-zinc-600"
        data-testid="recommendation-reason"
      >
        {review?.recommendation_reason ?? "—"}
      </td>
      <td className="px-4 py-4">
        <AlertLevelLabel review={review} />
      </td>
      <td className="px-4 py-4 text-zinc-600" data-testid="last-supplier">
        {review?.last_supplier_name ?? "—"}
      </td>
      <td
        className="px-4 py-4 text-right text-zinc-600"
        data-testid="last-purchase-price"
      >
        {formatPurchasePrice(review?.last_purchase_price)}
      </td>
      <td
        className="px-4 py-4 text-zinc-600"
        data-testid="last-purchase-date"
      >
        {formatPurchaseDate(review?.last_purchase_date)}
      </td>
      <td
        className="px-4 py-4 text-right text-zinc-600"
        data-testid="purchase-count"
      >
        {review?.purchase_count == null ? "—" : review.purchase_count}
      </td>
      <td className="px-4 py-4 text-right text-zinc-600">{item.minimum_stock}</td>
      <td className="px-4 py-4 text-right font-medium text-zinc-900">
        €{item.cost_per_unit.toFixed(2)}
      </td>
      <td className="px-4 py-4 text-right">
        <div className="inline-flex items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(item)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
}
