/**
 * Tells the menu counter that write-off requests changed (sent, approved or
 * rejected) so it reads the pending count again. A plain window event — no
 * realtime subscription.
 */

export const WRITE_OFF_REQUESTS_CHANGED_EVENT = "write-off-requests:changed";

export function notifyWriteOffRequestsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(WRITE_OFF_REQUESTS_CHANGED_EVENT));
  }
}
