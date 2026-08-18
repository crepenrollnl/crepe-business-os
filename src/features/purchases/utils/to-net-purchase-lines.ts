/**
 * Variant C: persist exclusive net `unit_cost` for sql/069.
 *
 * Inclusive lines take `net_amount` from calculate_purchase_taxes — never
 * invert VAT in JS. `entered_unit_price` keeps the typed amount for reopen.
 *
 * sql/072 already subtracts `discount` from the typed (gross, for inclusive)
 * line before computing tax: `amount = qty * unit_price - discount`. The
 * returned `net_amount` is therefore the exclusive line AFTER discount.
 * sql/069 then does `line_total = round(qty * unit_cost) - discount` with
 * the same discount number. Dividing `net_amount` by qty and sending that
 * unit_cost plus the original discount would subtract discount twice.
 *
 * Invert sql/069 instead: store the pre-discount net unit so one sql/069
 * subtraction yields the tax RPC net. Discount is in the same units as the
 * typed unit price (gross on inclusive lines). It is NOT VAT-stripped here —
 * sql/069 subtracts that same absolute amount, so adding that same amount
 * back is the unique inverse. Stripping VAT from discount would make
 * `calculate_purchase_totals` disagree with `calculate_purchase_taxes`.
 */

import { fail, ok, type ServiceResult } from "@/types/service";
import type { PurchaseLineInput } from "../types/purchase";
import type { PurchaseTaxResult } from "../types/purchase-tax";

const UNIT_COST_DECIMAL_PLACES = 4;

function roundUnitCost(value: number): number {
  const factor = 10 ** UNIT_COST_DECIMAL_PLACES;
  return Math.round(value * factor) / factor;
}

export function toNetPurchaseLines(
  lines: readonly PurchaseLineInput[],
  taxResult: PurchaseTaxResult,
): ServiceResult<PurchaseLineInput[]> {
  const converted: PurchaseLineInput[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      return fail("Purchase document must include at least one line.");
    }

    const entered = line.unit_cost;
    const priceMode =
      line.price_mode === "inclusive" ? "inclusive" : "exclusive";

    if (!Number.isFinite(entered) || entered < 0) {
      return fail("Unit price must be 0 or greater");
    }

    let unitCost = entered;

    if (priceMode === "inclusive") {
      const taxLine = taxResult.lines.find(
        (row) => row.line_id === `line-${index + 1}`,
      );

      if (!taxLine) {
        return fail(
          "Tax result is missing a line needed to convert an inclusive unit price.",
        );
      }

      if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
        return fail("Quantity must be greater than zero");
      }

      const discount = line.discount ?? 0;
      unitCost = roundUnitCost(
        (taxLine.net_amount + discount) / line.quantity,
      );
    }

    converted.push({
      ...line,
      unit_cost: unitCost,
      entered_unit_price: entered,
      price_mode: priceMode,
    });
  }

  return ok(converted);
}
