/**
 * # Production Planning — Domain Layer (EPIC 2)
 *
 * Pure business model + calculation engine for Production Planning.
 *
 * ## Location
 *
 * Ticket path `src/modules/production-planning/` maps to
 * `src/features/production-planning/` per `docs/MODULE_FOUNDATION.md`
 * (do not create a parallel `src/modules/` tree).
 *
 * Live Planning UI / persistence remain in `src/features/production`.
 * This package is the domain contract those features should converge on.
 *
 * ## Boundaries (Architecture Freeze)
 *
 * Planning **may**: calculate, validate, aggregate.
 *
 * Planning **must not**:
 * - modify inventory
 * - create purchases
 * - create production batches
 * - consume stock
 * - post accounting
 *
 * Domain service interfaces expose read / calculate APIs only.
 *
 * ## Public API
 *
 * ### Domain entities
 * - `ProductionPlan`
 * - `ProductionPlanLine`
 * - `IngredientRequirement`
 * - `PlanningResult` / `PlanningSummary`
 * - `buildPlanningSummary`, `computeShortageQuantity`, `derivePlanningStatus`
 *
 * ### Calculation engine (DEV-003)
 * - `calculateProductionPlan`
 * - `createProductionPlanningCalculator`
 * - `CalculateProductionPlanInput` / `CalculateProductionPlanOutput`
 *
 * ### Shopping list generator (DEV-004)
 * - `generateShoppingList`
 * - `validatePlanningResultForShoppingList`
 * - `ShoppingList` / `ShoppingListItem` / `ShoppingListSummary`
 * - `GenerateShoppingListOutput`
 *
 * ### Procurement recommendation engine (DEV-005)
 * - `generateProcurementRecommendation`
 * - `validateShoppingListForProcurement`
 * - `ProcurementRecommendation` / `ProcurementRecommendationItem` / `ProcurementRecommendationSummary`
 * - `IngredientPackagingInfo`
 * - `ProcurementRecommendationReason` / `PROCUREMENT_RECOMMENDATION_REASONS`
 * - `GenerateProcurementRecommendationInput` / `GenerateProcurementRecommendationOutput`
 * - `roundUpToPackageQuantity`
 *
 * ### Purchase draft builder (DEV-006)
 * - `generatePurchaseDrafts`
 * - `validateProcurementRecommendationForDraft`
 * - `PurchaseDraft` / `PurchaseDraftLine` / `PurchaseDraftCollection`
 * - `PurchaseDraftCollectionSummary`
 * - `PurchaseDraftStatus` / `PURCHASE_DRAFT_STATUSES`
 * - `GeneratePurchaseDraftsInput` / `GeneratePurchaseDraftsOutput`
 *
 * ### Status
 * - `ProductionPlanStatus`
 * - `PRODUCTION_PLAN_STATUSES`, `PRODUCTION_PLAN_STATUS_LABELS`
 * - `isProductionPlanStatus`
 *
 * ### Validation
 * - `validateProductionPlan`, `validatePlanningInventory`
 * - `ValidationResult`, `PlanValidationIssue`, `PlanValidationIssueCode`
 * - `validationOk`, `validationFail`
 *
 * ### Mappers (pure)
 * - `aggregateIngredientNeeds`
 * - `mapIngredientRequirements`
 * - `mapShortageSuggestions`
 * - `scaleRecipeIngredientNeed`
 *
 * ### Domain services (interfaces — no DB)
 * - `ProductionPlanningCalculator`
 * - `RecipeResolver`
 * - `InventoryAvailabilityProvider`
 * - `PurchaseSuggestionProvider`
 *
 * ### Capabilities
 * - `PLANNING_ALLOWED_CAPABILITIES`
 * - `PLANNING_FORBIDDEN_CAPABILITIES`
 *
 * ## Non-goals
 *
 * No React, pages, hooks, Supabase, SQL, migrations, API routes, or mock data.
 *
 * @packageDocumentation
 */

export type {
  IngredientRequirement,
  PlanningResult,
  PlanningSummary,
  ProductionPlan,
  ProductionPlanLine,
} from "./domain";
export {
  buildPlanningSummary,
  computeShortageQuantity,
  derivePlanningStatus,
} from "./domain";

export type {
  PlanningAllowedCapability,
  PlanningCalculationConfig,
  PlanningForbiddenCapability,
  PlanningInventoryItem,
  PlanningRecipe,
  PlanningRecipeIngredient,
  PlanningRecipeIngredientLine,
  PlanningRecipeComponentLine,
  PlanValidationIssue,
  PlanValidationIssueCode,
  ProductionPlanStatus,
  ResolvedRecipeBom,
  ValidationResult,
} from "./types";
export {
  DEFAULT_PLANNING_CALCULATION_CONFIG,
  isProductionPlanStatus,
  PLANNING_ALLOWED_CAPABILITIES,
  PLANNING_FORBIDDEN_CAPABILITIES,
  PRODUCTION_PLAN_STATUS_LABELS,
  PRODUCTION_PLAN_STATUSES,
  resolvePlanningCalculationConfig,
  validationFail,
  validationOk,
} from "./types";

export type {
  RecipeValidationContext,
  ValidatePlanningInventoryInput,
  ValidateProductionPlanInput,
} from "./validators";
export {
  validatePlanningInventory,
  validateProductionPlan,
} from "./validators";

export type {
  AggregateIngredientNeedsResult,
  IngredientRequirementDraft,
  PurchaseShortageSuggestion,
} from "./mappers";
export {
  aggregateIngredientNeeds,
  mapIngredientRequirements,
  mapShortageSuggestions,
  scaleRecipeIngredientNeed,
} from "./mappers";

export { explodeComponentRecipeBom } from "./engine/explode-component-bom";
export type { ExplodeComponentRecipeBomResult } from "./engine/explode-component-bom";

export type {
  CalculateProductionPlanInput,
  CalculateProductionPlanOutput,
} from "./engine";
export { calculateProductionPlan } from "./engine";

export type {
  GenerateShoppingListOutput,
  ShoppingList,
  ShoppingListItem,
  ShoppingListSummary,
} from "./shopping-list";
export {
  generateShoppingList,
  validatePlanningResultForShoppingList,
} from "./shopping-list";

export type {
  GenerateProcurementRecommendationInput,
  GenerateProcurementRecommendationOutput,
  IngredientPackagingInfo,
  PackagePurchaseQuantity,
  ProcurementRecommendation,
  ProcurementRecommendationItem,
  ProcurementRecommendationReason,
  ProcurementRecommendationSummary,
} from "./procurement";
export {
  generateProcurementRecommendation,
  isProcurementRecommendationReason,
  PROCUREMENT_RECOMMENDATION_REASONS,
  roundUpToPackageQuantity,
  validateShoppingListForProcurement,
} from "./procurement";

export type {
  GeneratePurchaseDraftsInput,
  GeneratePurchaseDraftsOutput,
  PurchaseDraft,
  PurchaseDraftCollection,
  PurchaseDraftCollectionSummary,
  PurchaseDraftLine,
  PurchaseDraftStatus,
} from "./purchase-draft";
export {
  generatePurchaseDrafts,
  isPurchaseDraftStatus,
  PURCHASE_DRAFT_STATUSES,
  validateProcurementRecommendationForDraft,
} from "./purchase-draft";

export type {
  InventoryAvailabilityProvider,
  ProductionPlanningCalculator,
  PurchaseSuggestion,
  PurchaseSuggestionProvider,
  RecipeResolver,
} from "./services";
export { createProductionPlanningCalculator } from "./services";
