import type {
  CalculatedIngredientRequirement,
  CalculatedProcurementItem,
  CalculatedShoppingListItem,
  ProductionPlanCalculationResult,
  ProductionPlanLinkedPurchase,
  PurchaseDraftLinkStatus,
} from "../types/production";
import {
  formatIngredientRequirementStatus,
  getIngredientRequirementStatusBadgeClass,
} from "../utils/derive-ingredient-requirement-status";
import { formatQuantity } from "../utils/format-quantity";
import { CollapsibleWorkspaceCard } from "./collapsible-workspace-card";
import { PurchaseDraftReviewPanel } from "./purchase-draft-review-panel";

type ProductionPlanCalculationWorkspaceProps = {
  result: ProductionPlanCalculationResult | null;
  isCalculating: boolean;
  error: string | null;
  transferStatus: PurchaseDraftLinkStatus;
  linkedPurchase: ProductionPlanLinkedPurchase | null;
  isTransferring: boolean;
  transferError: string | null;
  transferDisabled: boolean;
  onSendToPurchases: () => void;
};

function WorkspaceEmptyState({ message }: { message: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  );
}

function WorkspaceLoadingState({ message }: { message: string }) {
  return (
    <div className="space-y-3 px-4 py-6">
      <p className="text-sm font-medium text-zinc-700">{message}</p>
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          key={index}
          className="h-10 animate-pulse rounded-lg bg-zinc-100"
        />
      ))}
    </div>
  );
}

function IngredientRequirementsBody({
  rows,
}: {
  rows: CalculatedIngredientRequirement[];
}) {
  if (rows.length === 0) {
    return (
      <WorkspaceEmptyState message="No ingredient requirements for this plan." />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead className="bg-zinc-50">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
              Ingredient
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
              Required
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
              Available
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
              Missing
            </th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.ingredient_id}
              className="border-t border-zinc-200 bg-white"
            >
              <td className="px-4 py-3 text-sm font-medium text-zinc-900">
                {row.ingredient_name}
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  {row.unit}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-sm text-zinc-700">
                {formatQuantity(row.required_quantity)}
              </td>
              <td className="px-4 py-3 text-right text-sm text-zinc-700">
                {formatQuantity(row.available_quantity)}
              </td>
              <td className="px-4 py-3 text-right text-sm font-semibold text-zinc-800">
                {formatQuantity(row.missing_quantity)}
              </td>
              <td className="px-4 py-3 text-sm">
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${getIngredientRequirementStatusBadgeClass(
                    row.status,
                  )}`}
                >
                  {formatIngredientRequirementStatus(row.status)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ShoppingListBody({ rows }: { rows: CalculatedShoppingListItem[] }) {
  if (rows.length === 0) {
    return (
      <WorkspaceEmptyState message="Everything required is currently in stock." />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead className="bg-zinc-50">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
              Ingredient
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
              Quantity
            </th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
              Unit
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.ingredient_id}
              className="border-t border-zinc-200 bg-white"
            >
              <td className="px-4 py-3 text-sm font-medium text-zinc-900">
                {row.ingredient_name}
              </td>
              <td className="px-4 py-3 text-right text-sm text-zinc-700">
                {formatQuantity(row.quantity)}
              </td>
              <td className="px-4 py-3 text-sm text-zinc-600">{row.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProcurementBody({ rows }: { rows: CalculatedProcurementItem[] }) {
  if (rows.length === 0) {
    return <WorkspaceEmptyState message="No purchases are required." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full">
        <thead className="bg-zinc-50">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
              Ingredient
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
              Recommended Quantity
            </th>
            <th className="px-4 py-3 text-right text-sm font-semibold text-zinc-700">
              Packages
            </th>
            <th className="px-4 py-3 text-left text-sm font-semibold text-zinc-700">
              Reason
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.ingredient_id}
              className="border-t border-zinc-200 bg-white"
            >
              <td className="px-4 py-3 text-sm font-medium text-zinc-900">
                {row.ingredient_name}
                <span className="ml-2 text-xs font-normal text-zinc-500">
                  {row.unit}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-sm text-zinc-700">
                {formatQuantity(row.recommended_quantity)}
              </td>
              <td className="px-4 py-3 text-right text-sm text-zinc-700">
                {row.packages}
              </td>
              <td className="px-4 py-3 text-sm text-zinc-600">{row.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProductionPlanCalculationWorkspace({
  result,
  isCalculating,
  error,
  transferStatus,
  linkedPurchase,
  isTransferring,
  transferError,
  transferDisabled,
  onSendToPurchases,
}: ProductionPlanCalculationWorkspaceProps) {
  const beforeCalculation = !result && !isCalculating && !error;

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            Could not calculate requirements
          </p>
          <p className="mt-1 text-sm text-red-600">{error}</p>
        </div>
      ) : null}

      <CollapsibleWorkspaceCard
        title="Ingredient Requirements"
        description="Required ingredients versus current inventory availability."
      >
        {isCalculating ? (
          <WorkspaceLoadingState message="Calculating ingredient requirements..." />
        ) : beforeCalculation ? (
          <WorkspaceEmptyState message="Run calculation to see ingredient requirements." />
        ) : result ? (
          <IngredientRequirementsBody rows={result.ingredient_requirements} />
        ) : (
          <WorkspaceEmptyState message="Run calculation to see ingredient requirements." />
        )}
      </CollapsibleWorkspaceCard>

      <CollapsibleWorkspaceCard
        title="Shopping List"
        description="Ingredients with a shortage that need to be purchased."
      >
        {isCalculating ? (
          <WorkspaceLoadingState message="Building shopping list..." />
        ) : beforeCalculation ? (
          <WorkspaceEmptyState message="Run calculation to see ingredient requirements." />
        ) : result ? (
          <ShoppingListBody rows={result.shopping_list} />
        ) : (
          <WorkspaceEmptyState message="Run calculation to see ingredient requirements." />
        )}
      </CollapsibleWorkspaceCard>

      <CollapsibleWorkspaceCard
        title="Procurement Recommendation"
        description="Suggested purchase quantities based on shortages."
      >
        {isCalculating ? (
          <WorkspaceLoadingState message="Building procurement recommendation..." />
        ) : beforeCalculation ? (
          <WorkspaceEmptyState message="Run calculation to see ingredient requirements." />
        ) : result ? (
          <ProcurementBody rows={result.procurement_recommendations} />
        ) : (
          <WorkspaceEmptyState message="Run calculation to see ingredient requirements." />
        )}
      </CollapsibleWorkspaceCard>

      <CollapsibleWorkspaceCard
        title="Purchase Draft Review"
        description="Review the draft lines before transferring them into Purchases."
      >
        {isCalculating ? (
          <WorkspaceLoadingState message="Preparing purchase draft..." />
        ) : beforeCalculation ? (
          <WorkspaceEmptyState message="Run calculation to review the purchase draft." />
        ) : result ? (
          <PurchaseDraftReviewPanel
            lines={result.purchase_draft_review}
            summary={result.purchase_draft_summary}
            transferStatus={transferStatus}
            linkedPurchase={linkedPurchase}
            isTransferring={isTransferring}
            transferError={transferError}
            disabled={transferDisabled}
            onSendToPurchases={onSendToPurchases}
          />
        ) : (
          <WorkspaceEmptyState message="Run calculation to review the purchase draft." />
        )}
      </CollapsibleWorkspaceCard>
    </div>
  );
}
