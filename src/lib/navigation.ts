import { ALL_ROLES, OWNER_PARTNER_ROLES, type AppRole } from "./roles";

export type NavItem = {
  label: string;
  href: string;
};

export interface RouteAccess {
  /** Route path; it also covers every path below it ("/sales" → "/sales/123"). */
  path: string;
  roles: readonly AppRole[];
}

/** Where a seller starts, and where "no access" sends people. */
export const SELLER_HOME_PATH = "/pos";

/** Sidebar page a seller reaches from full-screen POS ("Back to OS"). */
export const SELLER_MENU_PATH = "/sales";

/**
 * Who may open which page — the one source of truth for the menu
 * (isNavItemVisible) and the page guard (RoleGuard). The longest matching
 * path wins; "/" matches only the dashboard itself. A path that is not
 * listed is owner/partner only.
 */
export const routeAccess: readonly RouteAccess[] = [
  { path: "/", roles: OWNER_PARTNER_ROLES },
  { path: "/pos", roles: ALL_ROLES },
  { path: "/sales", roles: ALL_ROLES },
  { path: "/inventory", roles: ALL_ROLES },
  { path: "/inventory/ingredients", roles: OWNER_PARTNER_ROLES },
  { path: "/finished-goods", roles: ALL_ROLES },
  { path: "/recipes", roles: ALL_ROLES },
  { path: "/recipes/cost-report", roles: OWNER_PARTNER_ROLES },
  { path: "/purchases", roles: OWNER_PARTNER_ROLES },
  { path: "/production", roles: OWNER_PARTNER_ROLES },
  { path: "/production-planning", roles: OWNER_PARTNER_ROLES },
  { path: "/production-execution", roles: OWNER_PARTNER_ROLES },
  { path: "/accounting", roles: OWNER_PARTNER_ROLES },
  { path: "/expenses", roles: OWNER_PARTNER_ROLES },
  { path: "/fixed-assets", roles: OWNER_PARTNER_ROLES },
  { path: "/reports", roles: OWNER_PARTNER_ROLES },
];

function normalizePath(pathname: string): string {
  const path = pathname.split(/[?#]/)[0] ?? "";
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path || "/";
}

function routeMatches(routePath: string, pathname: string): boolean {
  if (routePath === "/") {
    return pathname === "/";
  }
  return pathname === routePath || pathname.startsWith(`${routePath}/`);
}

export function rolesForPath(pathname: string): readonly AppRole[] {
  const path = normalizePath(pathname);
  let best: RouteAccess | null = null;

  for (const route of routeAccess) {
    if (
      routeMatches(route.path, path) &&
      (best === null || route.path.length > best.path.length)
    ) {
      best = route;
    }
  }

  return best?.roles ?? OWNER_PARTNER_ROLES;
}

export function canAccessPath(pathname: string, role: string | null): boolean {
  if (role === null) {
    return false;
  }
  return rolesForPath(pathname).some((allowed) => allowed === role);
}

export function isNavItemVisible(item: NavItem, role: string | null): boolean {
  return canAccessPath(item.href, role);
}

/**
 * Target of "Back to OS" on full-screen POS: the dashboard for roles that
 * may open it, otherwise the Sales list (a page with the sidebar). Sending a
 * seller to "/" would only bounce them back to /pos (RoleGuard).
 */
export function osHomePathForRole(role: string | null): string {
  return canAccessPath("/", role) ? "/" : SELLER_MENU_PATH;
}

export const navItems: NavItem[] = [
  { label: "Dashboard", href: "/" },
  { label: "POS", href: "/pos" },
  { label: "Quick Sale", href: "/sales/quick" },
  { label: "Inventory", href: "/inventory" },
  { label: "Recipes", href: "/recipes" },
  { label: "Recipe Cost", href: "/recipes/cost-report" },
  { label: "Purchases", href: "/purchases" },
  { label: "Production Planning", href: "/production-planning" },
  { label: "Production Execution", href: "/production-execution" },
  { label: "Sales", href: "/sales" },
  { label: "Profit and Loss", href: "/accounting/profit-and-loss" },
  { label: "Expenses", href: "/expenses" },
  { label: "Fixed Assets", href: "/fixed-assets" },
  { label: "BTW Report", href: "/reports/btw" },
  { label: "Posting Failures", href: "/reports/posting-failures" },
  { label: "Reports", href: "/reports" },
  { label: "Sales by Product", href: "/reports/sales-by-product" },
];
