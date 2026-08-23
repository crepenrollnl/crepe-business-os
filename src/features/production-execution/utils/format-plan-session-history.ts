import type { ProductionPlanSessionHistoryItem } from "../types/production-session";
import {
  formatProductionSessionStatus,
  formatSessionQuantity,
} from "./format-production-session";

export function getPlanSessionDisplayDate(
  session: Pick<ProductionPlanSessionHistoryItem, "completed_at" | "started_at">,
): string {
  return session.completed_at ?? session.started_at;
}

export function pickLatestCompletedPlanSession(
  sessions: readonly ProductionPlanSessionHistoryItem[],
): ProductionPlanSessionHistoryItem | null {
  const completed = sessions.filter(
    (session) => session.status === "completed",
  );

  if (completed.length === 0) {
    return null;
  }

  return completed.reduce((latest, session) => {
    const latestKey = latest.completed_at ?? latest.started_at;
    const sessionKey = session.completed_at ?? session.started_at;
    return sessionKey > latestKey ? session : latest;
  });
}

function formatLineFact(
  line: ProductionPlanSessionHistoryItem["lines"][number],
): string | null {
  if (line.produced_quantity === null) {
    return null;
  }

  return `${formatSessionQuantity(line.produced_quantity)} ${line.yield_unit} ${line.product_name}`;
}

/**
 * Header/link label, e.g. "Session #1 · Completed · 7 kg Roasted chicken".
 */
export function formatPlanSessionFactLabel(
  session: Pick<
    ProductionPlanSessionHistoryItem,
    "session_number" | "status" | "lines"
  >,
): string {
  const prefix = `Session #${session.session_number} · ${formatProductionSessionStatus(session.status)}`;
  const facts = session.lines
    .map(formatLineFact)
    .filter((value): value is string => value !== null);

  if (facts.length === 0) {
    return prefix;
  }

  return `${prefix} · ${facts.join(", ")}`;
}
