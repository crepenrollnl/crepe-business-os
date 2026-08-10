/**
 * Canonical ERP module registry and build sequence.
 * Agents must follow this order unless explicitly instructed otherwise.
 *
 * Accounting is the sole financial module (VAT, taxes, GL, statements, bank accounts).
 *
 * Module root: `src/features/<id>/` (see docs/MODULE_FOUNDATION.md).
 * Do not introduce a parallel `src/modules/` tree.
 */

export type ErpModuleStatus = "live" | "planned";

export interface ErpModuleDefinition {
  id: string;
  label: string;
  /** Path relative to repo root. */
  featurePath: string;
  status: ErpModuleStatus;
  priority: number;
}

export const ERP_MODULES: readonly ErpModuleDefinition[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    featurePath: "src/features/dashboard",
    status: "live",
    priority: 1,
  },
  {
    id: "inventory",
    label: "Inventory",
    featurePath: "src/features/inventory",
    status: "live",
    priority: 2,
  },
  {
    id: "products",
    label: "Products",
    featurePath: "src/features/products",
    status: "planned",
    priority: 3,
  },
  {
    id: "recipes",
    label: "Recipes",
    featurePath: "src/features/recipes",
    status: "live",
    priority: 4,
  },
  {
    id: "suppliers",
    label: "Suppliers",
    featurePath: "src/features/suppliers",
    status: "planned",
    priority: 5,
  },
  {
    id: "purchases",
    label: "Purchases",
    featurePath: "src/features/purchases",
    status: "live",
    priority: 6,
  },
  {
    id: "production",
    label: "Production Planning",
    featurePath: "src/features/production",
    status: "live",
    priority: 7,
  },
  {
    id: "production-execution",
    label: "Production Execution",
    featurePath: "src/features/production-execution",
    status: "live",
    priority: 8,
  },
  {
    id: "finished-goods",
    label: "Finished Goods",
    featurePath: "src/features/finished-goods",
    status: "planned",
    priority: 9,
  },
  {
    id: "sales",
    label: "Sales",
    featurePath: "src/features/sales",
    status: "planned",
    priority: 10,
  },
  {
    id: "customers",
    label: "Customers",
    featurePath: "src/features/customers",
    status: "planned",
    priority: 11,
  },
  {
    id: "events",
    label: "Events",
    featurePath: "src/features/events",
    status: "planned",
    priority: 12,
  },
  {
    id: "accounting",
    label: "Accounting",
    featurePath: "src/features/accounting",
    status: "planned",
    priority: 13,
  },
  {
    id: "reports",
    label: "Reports",
    featurePath: "src/features/reporting-workspace",
    status: "live",
    priority: 14,
  },
  {
    id: "ai",
    label: "AI",
    featurePath: "src/features/ai",
    status: "planned",
    priority: 15,
  },
] as const;
