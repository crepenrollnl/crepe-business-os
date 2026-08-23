export type NavItem = {
  label: string;
  href: string;
};

export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "Inventory", href: "/inventory" },
  { label: "Recipes", href: "/recipes" },
  { label: "Purchases", href: "/purchases" },
  { label: "Production Planning", href: "/production-planning" },
  { label: "Production Execution", href: "/production-execution" },
  { label: "Finished Goods", href: "/finished-goods" },
  { label: "Sales", href: "/sales" },
  { label: "Expenses", href: "/expenses" },
  { label: "Fixed Assets", href: "/fixed-assets" },
  { label: "Reports", href: "/reports" },
  { label: "BTW Report", href: "/reports/btw" },
];
