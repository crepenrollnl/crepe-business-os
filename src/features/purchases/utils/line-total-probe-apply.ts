/**
 * Line-total probe orchestration (when to run, how to apply, what to show).
 *
 * Pinned Line total is receipt gross. The isolated RPC probe always returns
 * exclusive net; writing that net into an inclusive Unit price field is the
 * compound tax bug. Apply is therefore mode-dependent.
 */

import { formatNumericInput } from "@/components/ui/numeric-input";

export type LineTotalAnchorField =
  | "quantity"
  | "unit_cost"
  | "line_total"
  | null;

const UNIT_COST_DECIMAL_PLACES = 4;

function roundUnitCost(value: number): number {
  const factor = 10 ** UNIT_COST_DECIMAL_PLACES;
  return Math.round(value * factor) / factor;
}

export function shouldRunLineTotalProbe(
  lastEditedField: LineTotalAnchorField,
): boolean {
  return lastEditedField === "line_total";
}

export function shouldInvalidateLineTotalProbeOnPriceModeChange(
  lastEditedField: LineTotalAnchorField,
): boolean {
  return lastEditedField === "line_total";
}

export interface LineTotalProbeKeyInput {
  quantity: number;
  lineTotal: number;
  taxCategory: string;
  taxRegime: string;
  purchasedAt: string;
  taxCountry: string;
  supplierCountry: string;
  supplierId: string;
  priceMode: string;
}

export function buildLineTotalProbeKey(input: LineTotalProbeKeyInput): string {
  return [
    input.quantity,
    input.lineTotal,
    input.taxCategory,
    input.taxRegime,
    input.purchasedAt,
    input.taxCountry,
    input.supplierCountry,
    input.supplierId,
    input.priceMode,
  ].join("|");
}

export interface LineTotalProbeApplyInput {
  priceMode: string;
  probeNetUnitCost: number;
  pinnedGross: number;
  quantity: number;
}

/**
 * Exclusive: Unit price is net → write probe net.
 * Inclusive: Unit price is gross → write pinnedGross / qty, never probe net.
 */
export function unitCostAfterLineTotalProbe(
  input: LineTotalProbeApplyInput,
): number {
  if (input.priceMode === "inclusive") {
    return roundUnitCost(input.pinnedGross / input.quantity);
  }
  return input.probeNetUnitCost;
}

export function editableLineTotalValue(input: {
  lastEditedField: LineTotalAnchorField;
  pinnedLineTotal: string;
  previewGrossAmount: number | null | undefined;
}): string {
  if (input.lastEditedField === "line_total") {
    return input.pinnedLineTotal;
  }
  if (
    input.previewGrossAmount !== null &&
    input.previewGrossAmount !== undefined &&
    Number.isFinite(input.previewGrossAmount)
  ) {
    return formatNumericInput(input.previewGrossAmount);
  }
  return input.pinnedLineTotal;
}
