/**
 * Tax rounding strategy factory (DEV-096).
 *
 * Pure mechanics — Localization Packs choose mode/precision.
 */

import type { TaxRoundingMode, TaxRoundingStrategy } from "@/types/tax-engine";

function factorFor(decimalPlaces: number): number {
  return 10 ** decimalPlaces;
}

function roundHalfUp(value: number, decimalPlaces: number): number {
  const factor = factorFor(decimalPlaces);
  return Math.round(value * factor) / factor;
}

function roundHalfEven(value: number, decimalPlaces: number): number {
  const factor = factorFor(decimalPlaces);
  const scaled = value * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;

  if (diff > 0.5) {
    return (floor + 1) / factor;
  }
  if (diff < 0.5) {
    return floor / factor;
  }
  // Exactly .5 — banker's rounding
  return (floor % 2 === 0 ? floor : floor + 1) / factor;
}

function roundFloor(value: number, decimalPlaces: number): number {
  const factor = factorFor(decimalPlaces);
  return Math.floor(value * factor) / factor;
}

function roundCeil(value: number, decimalPlaces: number): number {
  const factor = factorFor(decimalPlaces);
  return Math.ceil(value * factor) / factor;
}

function roundTruncate(value: number, decimalPlaces: number): number {
  const factor = factorFor(decimalPlaces);
  return (value < 0 ? Math.ceil(value * factor) : Math.floor(value * factor)) / factor;
}

/**
 * Create a rounding strategy used by the Tax Calculation Pipeline.
 */
export function createTaxRoundingStrategy(
  mode: TaxRoundingMode = "half_up",
  decimalPlaces = 2,
): TaxRoundingStrategy {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 8) {
    throw new Error("Tax rounding decimal_places must be an integer between 0 and 8.");
  }

  return {
    mode,
    decimal_places: decimalPlaces,
    round(value: number): number {
      if (!Number.isFinite(value)) {
        return value;
      }
      switch (mode) {
        case "half_up":
          return roundHalfUp(value, decimalPlaces);
        case "half_even":
          return roundHalfEven(value, decimalPlaces);
        case "floor":
          return roundFloor(value, decimalPlaces);
        case "ceil":
          return roundCeil(value, decimalPlaces);
        case "truncate":
          return roundTruncate(value, decimalPlaces);
        default: {
          const _exhaustive: never = mode;
          return _exhaustive;
        }
      }
    },
  };
}
