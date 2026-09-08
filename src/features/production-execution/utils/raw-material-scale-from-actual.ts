import { roundQuantity } from "@/lib/quantity";

export type RawMaterialScaleFromActualResult =
  | { ok: true; kind: "empty" }
  | { ok: true; kind: "scale"; scale: number }
  | { ok: false; error: string };

/**
 * Recipe Batches Used = actual weighed qty ÷ declared recipe qty.
 * Empty input is a no-op for the scale field. Zero/invalid does not yield 0.
 */
export function computeRawMaterialScaleFromActual(
  enteredRaw: string,
  declaredQuantity: number,
): RawMaterialScaleFromActualResult {
  const trimmed = enteredRaw.trim();
  if (trimmed.length === 0) {
    return { ok: true, kind: "empty" };
  }

  const entered = Number(trimmed);
  if (!Number.isFinite(entered)) {
    return { ok: false, error: "Enter a valid quantity." };
  }

  if (entered <= 0) {
    return { ok: false, error: "Quantity must be greater than zero." };
  }

  if (!Number.isFinite(declaredQuantity) || declaredQuantity <= 0) {
    return {
      ok: false,
      error: "Recipe quantity for this ingredient is invalid.",
    };
  }

  return {
    ok: true,
    kind: "scale",
    scale: roundQuantity(entered / declaredQuantity),
  };
}
