import type { ProductionPlanProduct } from "../types/production-execution";
import { formatQuantity } from "../utils/format-execution-plan";

type ProductionExecutionProductsSectionProps = {
  products: ProductionPlanProduct[];
};

function formatStatus(status: ProductionPlanProduct["status"]): string {
  return status === "active" ? "Active" : "Inactive";
}

function getStatusBadgeClass(status: ProductionPlanProduct["status"]): string {
  return status === "active"
    ? "bg-green-100 text-green-700"
    : "bg-zinc-100 text-zinc-600";
}

export function ProductionExecutionProductsSection({
  products,
}: ProductionExecutionProductsSectionProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-4">
        <h2 className="text-base font-semibold text-zinc-900">Products</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          {products.length === 0
            ? "No products on this plan."
            : `${products.length} product${products.length === 1 ? "" : "s"} planned for production`}
        </p>
      </div>

      {products.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium text-zinc-900">No products</p>
          <p className="mt-1 text-sm text-zinc-500">
            This plan has no products to produce.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead className="bg-zinc-50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Product
                </th>
                <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                  Target / Planned
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Unit
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Recipe
                </th>
                <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr
                  key={product.id}
                  className="border-t border-zinc-200 transition-colors hover:bg-zinc-50"
                >
                  <td className="px-4 py-4 font-medium text-zinc-900">
                    {product.recipe_name}
                  </td>
                  <td className="px-4 py-4 text-right text-zinc-700">
                    {formatQuantity(product.planned_quantity)}
                  </td>
                  <td className="px-4 py-4 text-zinc-600">
                    {product.yield_unit}
                  </td>
                  <td className="px-4 py-4 text-zinc-600">
                    {product.recipe_name}
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${getStatusBadgeClass(
                        product.status,
                      )}`}
                    >
                      {formatStatus(product.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
