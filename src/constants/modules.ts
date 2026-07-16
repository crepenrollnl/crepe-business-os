/**
 * Canonical ERP module registry and build sequence.
 * Agents must follow this order unless explicitly instructed otherwise.
 */

export interface ErpModuleDefinition {
  id: string;
  label: string;
  featurePath: string;
  status: "live" | "planned";
  priority: number;
}

export const ERP_MODULES: readonly ErpModuleDefinition[] = [
  {
    id: "inventory",
    label: "Inventory",
    featurePath: "src/features/inventory",
    status: "live",
    priority: 1,
  },
  {
    id: "products",
    label: "Products",
    featurePath: "src/features/products",
    status: "planned",
    priority: 2,
  },
  {
    id: "recipes",
    label: "Recipes",
    featurePath: "src/features/recipes",
    status: "planned",
    priority: 3,
  },
  {
    id: "sales",
    label: "Sales",
    featurePath: "src/features/sales",
    status: "planned",
    priority: 4,
  },
  {
    id: "purchases",
    label: "Purchases",
    featurePath: "src/features/purchases",
    status: "planned",
    priority: 5,
  },
  {
    id: "production",
    label: "Production",
    featurePath: "src/features/production",
    status: "planned",
    priority: 6,
  },
  {
    id: "suppliers",
    label: "Suppliers",
    featurePath: "src/features/suppliers",
    status: "planned",
    priority: 7,
  },
  {
    id: "customers",
    label: "Customers",
    featurePath: "src/features/customers",
    status: "planned",
    priority: 8,
  },
  {
    id: "finance",
    label: "Finance",
    featurePath: "src/features/finance",
    status: "planned",
    priority: 9,
  },
  {
    id: "accounting",
    label: "Accounting",
    featurePath: "src/features/accounting",
    status: "planned",
    priority: 10,
  },
  {
    id: "taxes",
    label: "Taxes",
    featurePath: "src/features/taxes",
    status: "planned",
    priority: 11,
  },
  {
    id: "reports",
    label: "Reports",
    featurePath: "src/features/reports",
    status: "planned",
    priority: 12,
  },
  {
    id: "ai",
    label: "AI",
    featurePath: "src/features/ai",
    status: "planned",
    priority: 13,
  },
] as const;
