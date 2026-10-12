/**
 * Non-blocking warning shown after a sale was confirmed (audit D3).
 *
 * reloadError: the sale is committed but re-reading it failed.
 * postingError: the sale is committed but its journals were not posted.
 * Neither means the sale failed, so hooks show this next to the success
 * state instead of as an action error.
 */
export function confirmWarning(
  reloadError: string | null,
  postingError: string | null,
): string | null {
  const parts: string[] = [];

  if (reloadError) {
    parts.push(`Sale confirmed, but it could not be reloaded: ${reloadError}`);
  }

  if (postingError) {
    parts.push(postingError);
  }

  return parts.length > 0 ? parts.join(" ") : null;
}
