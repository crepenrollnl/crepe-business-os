/**
 * Sales → Accounting read contract (DEV-111).
 *
 * Sale journals (sale_completed + cogs_recognized) are posted by the
 * database at COMMIT of the confirmation (sql/147, audit D2/K3). Sales only
 * reads whether they exist.
 */

/** Sale-level accounting journal status (DEV-109 / DEV-111). */
export type SaleAccountingPostingStatus = "posted" | "pending";
