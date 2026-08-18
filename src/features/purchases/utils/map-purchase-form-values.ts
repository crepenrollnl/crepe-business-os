/**
 * Map a stored purchase document onto form values.
 *
 * The Unit price field shows what the user typed (`entered_unit_price`)
 * when that memory exists; otherwise the persisted net `unit_cost`.
 * Null tax fields stay null — the form must not substitute goods / standard_vat.
 */

import type {
  PurchaseFormValues,
  PurchaseWithRelations,
} from "../types/purchase";

export function purchaseToFormValues(
  purchase: PurchaseWithRelations,
): PurchaseFormValues {
  return {
    supplier_id: purchase.supplier_id ?? "",
    invoice_number: purchase.invoice_number ?? "",
    purchased_at: purchase.purchased_at.slice(0, 10),
    notes: purchase.notes ?? "",
    supplier_country: "NL",
    tax_country: "NL",
    lines:
      purchase.items.length > 0
        ? purchase.items.map((item) => ({
            ingredient_id: item.ingredient_id,
            quantity: item.quantity,
            unit_cost: item.entered_unit_price ?? item.unit_cost,
            discount: 0,
            tax_category: item.tax_category,
            tax_regime: item.tax_regime,
            price_mode: item.price_mode,
            entered_unit_price: item.entered_unit_price,
          }))
        : [
            {
              ingredient_id: "",
              quantity: 1,
              unit_cost: 0,
              discount: 0,
              tax_category: "goods",
              tax_regime: "standard_vat",
              price_mode: "exclusive",
            },
          ],
  };
}
