export type NavItem = {
  label: string;
  href: string;
  /** When set, the item is shown only if the current user's role is in this list. */
  roles?: string[];
};

export function isNavItemVisible(item: NavItem, role: string | null): boolean {
  if (!item.roles || item.roles.length === 0) {
    return true;
  }

  return role !== null && item.roles.includes(role);
}

export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "Inventory", href: "/inventory" },
  { label: "Recipes", href: "/recipes" },
  { label: "Purchases", href: "/purchases" },
  { label: "Production Planning", href: "/production-planning" },
  { label: "Production Execution", href: "/production-execution" },
  { label: "Sales", href: "/sales" },
  { label: "Expenses", href: "/expenses" },
  { label: "Fixed Assets", href: "/fixed-assets" },
  { label: "Reports", href: "/reports" },
  {
    label: "Posting Failures",
    href: "/reports/posting-failures",
    roles: ["owner", "partner"],
  },
  { label: "BTW Report", href: "/reports/btw" },
  { label: "Sales by Product", href: "/reports/sales-by-product" },
];
