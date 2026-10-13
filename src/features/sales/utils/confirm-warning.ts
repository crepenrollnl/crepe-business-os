/**
 * Non-blocking warning shown after a sale was confirmed (audit D3).
 *
 * reloadError: the sale is committed but re-reading it failed.
 * otherWarning: any other follow-up problem (e.g. send-to-queue failed).
 * Neither means the sale failed, so hooks show this next to the success
 * state instead of as an action error. Accounting is not involved: the
 * database posts sale journals itself (sql/147).
 */
export function confirmWarning(
  reloadError: string | null,
  otherWarning: string | null,
): string | null {
  const parts: string[] = [];

  if (reloadError) {
    parts.push(`Sale confirmed, but it could not be reloaded: ${reloadError}`);
  }

  if (otherWarning) {
    parts.push(otherWarning);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}
