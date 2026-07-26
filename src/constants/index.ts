/**
 * Shared constants barrel.
 * Prefer importing from specific files in app code for clearer deps;
 * this barrel is for agents and docs convenience.
 */

export {
  DEFAULT_CURRENCY,
  DEFAULT_CURRENCY_SYMBOL,
  DEFAULT_LOCALE,
  MONEY_DECIMAL_PLACES,
} from "./config";

export {
  DEFAULT_LOOKUP_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_NAME_LENGTH,
  MAX_NOTES_LENGTH,
  PAGE_SIZE_OPTIONS,
  SEARCH_DEBOUNCE_MS,
} from "./limits";

export {
  ERP_MODULES,
  type ErpModuleDefinition,
  type ErpModuleStatus,
} from "./modules";

export {
  ACTIVATION_STATUSES,
  ACTIVATION_STATUS_LABELS,
  DOCUMENT_LIFECYCLE_LABELS,
  DOCUMENT_LIFECYCLE_STATUSES,
  STOCK_AVAILABILITY_LABELS,
  STOCK_AVAILABILITY_STATUSES,
} from "./statuses";

export {
  DEFAULT_YIELD_UNIT,
  INVENTORY_UNITS,
  YIELD_UNITS,
  isInventoryUnit,
  isYieldUnit,
  type InventoryUnit,
  type YieldUnit,
} from "./units";
