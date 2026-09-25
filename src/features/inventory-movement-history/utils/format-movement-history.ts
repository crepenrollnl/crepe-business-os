/**
 * Display helpers for ingredient movement history (read-only UI).
 * Does not recalculate quantities or invent movement types.
 */

export const MOVEMENT_HISTORY_STOCK_WARNING =
  "This list shows purchases received into stock, ingredients used in production, ingredients sold as recipe add-ins, write-offs, and stock adjustments. The quantity on the ingredient card can still differ if older activity was never recorded here.";

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
  if (
    movementType === "purchase_in" ||
    movementType === "adjustment_increase"
  ) {
    return "+";
  }

  if (
    movementType === "production_out" ||
    movementType === "sale_out" ||
    movementType === "waste_out" ||
    movementType === "adjustment_decrease"
  ) {
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
    case "waste_out":
      return "Written off";
    case "adjustment_increase":
      return "Stock increase";
    case "adjustment_decrease":
      return "Stock decrease";
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

  if (sourceType === "write_off") {
    return {
      label: "Write-off",
      href: sourceId ? `/inventory?tab=write-offs` : null,
    };
  }

  if (sourceType === "inventory_adjustment") {
    return { label: "Stock adjustment", href: null };
  }

  if (!sourceId) {
    return { label: "—", href: null };
  }

  return { label: sourceType, href: null };
}
