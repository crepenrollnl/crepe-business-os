import type { WriteOffReason, WriteOffRecord, WriteOffPeriodTotals } from "../types/write-off";
import { WRITE_OFF_REASONS } from "../types/write-off";

export function defaultWriteOffPeriod(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function isWriteOffInPeriod(
  createdAt: string,
  from: string,
  to: string,
): boolean {
  const day = createdAt.slice(0, 10);
  return day >= from && day <= to;
}

export function summarizeWriteOffs(
  rows: readonly WriteOffRecord[],
  from: string,
  to: string,
): WriteOffPeriodTotals {
  const byReason = Object.fromEntries(
    WRITE_OFF_REASONS.map((reason) => [reason, 0]),
  ) as Record<WriteOffReason, number>;

  let totalValue = 0;
  for (const row of rows) {
    if (!isWriteOffInPeriod(row.created_at, from, to)) {
      continue;
    }
    totalValue += row.total_value;
    byReason[row.reason] += row.total_value;
  }

  return { totalValue, byReason };
}
