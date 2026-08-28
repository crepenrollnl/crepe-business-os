/**
 * Display helpers for ingredient movement history (read-only UI).
 * Does not recalculate quantities or invent movement types.
 */

export const MOVEMENT_HISTORY_STOCK_WARNING =
  "This list shows purchases received into stock, ingredients used in production, and ingredients sold as recipe add-ins. The quantity on the ingredient card can still differ if stock was typed in by hand or if older activity was never recorded here.";

export interface MovementDocumentLink {
  label: string;
  href: string | null;
}

function formatQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(3).replace(/\.?0+$/, "");
}

function movementQuantitySign(movementType: string): "+" | "−" | "" {
  if (movementType === "purchase_in") {
    return "+";
  }

  if (movementType === "production_out" || movementType === "sale_out") {
    return "−";
  }

  return "";
}

export function formatMovementType(movementType: string): string {
  switch (movementType) {
    case "purchase_in":
      return "Received";
    case "production_out":
      return "Used in production";
    case "sale_out":
      return "Sold with product";
    default:
      return movementType;
  }
}

export function formatMovementQuantity(
  quantity: number,
  unit: string,
  movementType: string,
): string {
  const sign = movementQuantitySign(movementType);
  return `${sign}${formatQuantity(quantity)} ${unit}`;
}

export function movementDocumentLink(
  sourceType: string,
  sourceId: string | null,
): MovementDocumentLink {
  if (sourceType === "purchase") {
    return {
      label: "Purchase",
      href: sourceId ? `/purchases?open=${sourceId}` : null,
    };
  }

  if (sourceType === "production_session") {
    return {
      label: "Production session",
      href: sourceId
        ? `/production-execution/sessions/${sourceId}`
        : null,
    };
  }

  if (sourceType === "sale") {
    return { label: "Sale", href: null };
  }

  if (!sourceId) {
    return { label: "—", href: null };
  }

  return { label: sourceType, href: null };
}
