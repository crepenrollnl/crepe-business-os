/**
 * Client preview of a whole-sale header discount.
 *
 * Catalog gross is VAT-inclusive (qty × list unit_price). SQL
 * apply_sale_header_discount is the source of truth at confirm.
 */

import { roundMoney } from "@/lib/money";
import type { SaleDiscountType } from "../types/sale";

export type { SaleDiscountType };

export interface ResolvedSaleHeaderDiscount {
  discountAmount: number;
  payable: number;
  error: string | null;
}

export function resolveSaleHeaderDiscount(input: {
  catalogGross: number;
  type: SaleDiscountType;
  value: number | null;
}): ResolvedSaleHeaderDiscount {
  const catalogGross = roundMoney(Math.max(0, input.catalogGross));

  if (input.value === null) {
    return { discountAmount: 0, payable: catalogGross, error: null };
  }

  if (!Number.isFinite(input.value) || input.value < 0) {
    return {
      discountAmount: 0,
      payable: catalogGross,
      error: "Discount must not be negative.",
    };
  }

  if (input.type === "percent") {
    if (input.value > 100) {
      return {
        discountAmount: 0,
        payable: catalogGross,
        error: "Percent discount cannot exceed 100.",
      };
    }

    const discountAmount = roundMoney((catalogGross * input.value) / 100);
    return {
      discountAmount,
      payable: roundMoney(catalogGross - discountAmount),
      error: null,
    };
  }

  const discountAmount = roundMoney(input.value);
  if (discountAmount > catalogGross) {
    return {
      discountAmount: 0,
      payable: catalogGross,
      error: "Discount cannot exceed the sale total.",
    };
  }

  return {
    discountAmount,
    payable: roundMoney(catalogGross - discountAmount),
    error: null,
  };
}

export function parseDiscountInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}
