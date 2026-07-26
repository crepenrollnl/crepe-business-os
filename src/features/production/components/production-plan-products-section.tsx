import type { ProductionPlanProduct } from "../types/production";

type ProductionPlanProductsSectionProps = {
  products: ProductionPlanProduct[];
  canEdit: boolean;
  onAddProduct: () => void;
  onEditQuantity: (product: ProductionPlanProduct) => void;
  onRemoveProduct: (product: ProductionPlanProduct) => void;
};

function formatStatus(status: ProductionPlanProduct["status"]): string {
  return status === "active" ? "Active" : "Inactive";
}

function getStatusBadgeClass(status: ProductionPlanProduct["status"]): string {
  return status === "active"
    ? "bg-green-100 text-green-700"
    : "bg-zinc-100 text-zinc-600";
}

export function ProductionPlanProductsSection({
  products,
  canEdit,
  onAddProduct,
  onEditQuantity,
  onRemoveProduct,
}: ProductionPlanProductsSectionProps) {
  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">Products</h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            {products.length === 0
              ? "No products added yet."
              : `${products.length} product${products.length === 1 ? "" : "s"} on this plan`}
          </p>
        </div>
        {canEdit ? (
          <button
            type="button"
            onClick={onAddProduct}
            className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
          >
            + Add Product
          </button>
        ) : null}
      </div>

      {products.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm font-medium text-zinc-900">
            No products added yet.
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            Add finished goods to prepare this plan for calculation.
          </p>
          {canEdit ? (
            <button
              type="button"
              onClick={onAddProduct}
              className="mt-6 inline-flex items-center justify-center rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-amber-600"
            >
              + Add Product
            </button>
          ) : null}
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
                  Planned Quantity
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
                <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
                  Actions
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
                    {product.planned_quantity}
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
                  <td className="px-4 py-4 text-right">
                    {canEdit ? (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onEditQuantity(product)}
                          className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
                        >
                          Edit quantity
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveProduct(product)}
                          className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-400">—</span>
                    )}
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
