/**
 * Application roles (profiles.role, read through get_my_role(), sql/097).
 *
 * The database enforces every rule on its own (RLS + require_role); these
 * helpers only decide what the app shows, so a seller never sees a screen
 * or a figure the database would refuse anyway.
 */

export type AppRole = "owner" | "partner" | "seller";

export const ALL_ROLES: readonly AppRole[] = ["owner", "partner", "seller"];

export const OWNER_PARTNER_ROLES: readonly AppRole[] = ["owner", "partner"];

/**
 * Owner and partner see purchase prices, costs, COGS, stock value and
 * profit, and are the only roles that change master data (ingredients,
 * recipes, stock) — the same owner/partner bar the database uses
 * (sql/098, sql/124, sql/141). Sellers never do.
 */
export function canSeeCosts(role: string | null): boolean {
  return OWNER_PARTNER_ROLES.some((allowed) => allowed === role);
}
