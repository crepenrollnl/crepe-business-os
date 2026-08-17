import type {
  ProductionSessionLine,
  ProductionSessionLineInput,
  ProductionSessionLineView,
} from "../types/production-session";

export function computeLineDifference(
  plannedQuantity: number,
  actualProducedQuantity: number | null,
): number | null {
  if (actualProducedQuantity === null) {
    return null;
  }

  return actualProducedQuantity - plannedQuantity;
}

export function toSessionLineView(
  line: ProductionSessionLine,
): ProductionSessionLineView {
  return {
    ...line,
    difference: computeLineDifference(
      line.planned_quantity,
      line.actual_produced_quantity,
    ),
  };
}

/**
 * Produced quantity validation.
 * - null / empty: not entered yet
 * - 0 allowed
 * - may exceed planned
 * - negative not allowed
 */
export function parseProducedQuantityInput(
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }

  const value = Number(trimmed);

  if (!Number.isFinite(value)) {
    return { ok: false, error: "Enter a valid produced quantity." };
  }

  if (value < 0) {
    return { ok: false, error: "Produced quantity cannot be negative." };
  }

  return { ok: true, value };
}

export function validateProducedQuantity(
  value: number | null,
): string | null {
  if (value === null) {
    return null;
  }

  if (!Number.isFinite(value)) {
    return "Enter a valid produced quantity.";
  }

  if (value < 0) {
    return "Produced quantity cannot be negative.";
  }

  return null;
}

export function parseRawMaterialScaleInput(
  raw: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: true, value: null };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { ok: false, error: "Enter a valid number of recipe batches." };
  }
  if (value <= 0) {
    return { ok: false, error: "Recipe batches used must be greater than zero." };
  }
  return { ok: true, value };
}

export function validateRawMaterialScale(
  value: number | null,
): string | null {
  if (value === null) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return "Enter a valid number of recipe batches.";
  }
  if (value <= 0) {
    return "Recipe batches used must be greater than zero.";
  }
  return null;
}

export function hasAllProducedQuantities(
  lines: ReadonlyArray<Pick<ProductionSessionLineInput, "actual_produced_quantity">>,
): boolean {
  if (lines.length === 0) {
    return false;
  }

  return lines.every((line) => line.actual_produced_quantity !== null);
}

export function canFinishProductionSession(
  lines: ReadonlyArray<Pick<ProductionSessionLineInput, "actual_produced_quantity">>,
): boolean {
  if (!hasAllProducedQuantities(lines)) {
    return false;
  }

  return lines.every(
    (line) => validateProducedQuantity(line.actual_produced_quantity) === null,
  );
}

export function validateSessionLinesForComplete(
  lines: ProductionSessionLineInput[],
): string | null {
  if (lines.length === 0) {
    return "This session has no products to produce.";
  }

  for (const line of lines) {
    if (line.actual_produced_quantity === null) {
      return "Enter an actual produced quantity for every product before finishing.";
    }

    const error = validateProducedQuantity(line.actual_produced_quantity);
    if (error) {
      return error;
    }

    const scaleError = validateRawMaterialScale(line.raw_material_scale);
    if (scaleError) {
      return scaleError;
    }
  }

  return null;
}
