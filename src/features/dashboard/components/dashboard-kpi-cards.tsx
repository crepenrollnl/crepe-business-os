import type { DashboardSummary } from "../types/dashboard";
import { DashboardCard } from "./dashboard-card";

type DashboardKpiCardsProps = {
  summary: DashboardSummary;
};

function formatMoney(value: number): string {
  return `€${value.toFixed(2)}`;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatTimestamp(value: string | null): string {
  if (value === null) {
    return "—";
  }

  return value;
}

/**
 * Presentational KPI cards. Values come from DashboardSummary as-is.
 */
export function DashboardKpiCards({ summary }: DashboardKpiCardsProps) {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      <DashboardCard title="Total Inventory Value">
        <p className="text-3xl font-semibold tabular-nums">
          {formatMoney(summary.total_inventory_value)}
        </p>
      </DashboardCard>

      <DashboardCard title="Items Below Minimum">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.inventory_items_below_minimum)}
        </p>
      </DashboardCard>

      <DashboardCard title="Finished Goods Available">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.finished_goods_available)}
        </p>
      </DashboardCard>

      <DashboardCard title="Total Sales">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.total_sales_count)}
        </p>
      </DashboardCard>

      <DashboardCard title="Total Purchases">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.total_purchase_count)}
        </p>
      </DashboardCard>

      <DashboardCard title="Active Customers">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.active_customers_count)}
        </p>
      </DashboardCard>

      <DashboardCard title="Active Suppliers">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.active_suppliers_count)}
        </p>
      </DashboardCard>

      <DashboardCard title="Low Stock Items">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.low_stock_items)}
        </p>
      </DashboardCard>

      <DashboardCard title="Out of Stock Items">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.out_of_stock_items)}
        </p>
      </DashboardCard>

      <DashboardCard title="Batches In Progress">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.batches_in_progress)}
        </p>
      </DashboardCard>

      <DashboardCard title="Finished Batches Today">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.finished_batches_today)}
        </p>
      </DashboardCard>

      <DashboardCard title="Draft Sales">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.draft_sales_count)}
        </p>
      </DashboardCard>

      <DashboardCard title="Confirmed Sales Today">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.confirmed_sales_today)}
        </p>
      </DashboardCard>

      <DashboardCard title="Draft Purchases">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.draft_purchase_count)}
        </p>
      </DashboardCard>

      <DashboardCard title="Completed Purchases Today">
        <p className="text-3xl font-semibold tabular-nums">
          {formatCount(summary.completed_purchases_today)}
        </p>
      </DashboardCard>

      <DashboardCard title="Last Inventory Movement">
        <p className="text-lg font-semibold tabular-nums break-all">
          {formatTimestamp(summary.last_inventory_movement_at)}
        </p>
      </DashboardCard>

      <DashboardCard title="Last Sale">
        <p className="text-lg font-semibold tabular-nums break-all">
          {formatTimestamp(summary.last_sale_at)}
        </p>
      </DashboardCard>

      <DashboardCard title="Last Purchase">
        <p className="text-lg font-semibold tabular-nums break-all">
          {formatTimestamp(summary.last_purchase_at)}
        </p>
      </DashboardCard>
    </div>
  );
}
