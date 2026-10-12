/**
 * Re-price a Quick Sale / POS cart after the catalog price changed (audit D4).
 *
 * Since sql/146 add_sale_line always stores recipes.selling_price and rejects
 * a client price that no longer matches it with
 * 'The price of "<name>" is now €X. Refresh the screen and try again.'
 * The hooks then reload the product list and run the cart through this
 * helper so the seller sees the new total and can confirm again.
 */

export const PRICE_CHANGED_ERROR_PREFIX = 'The price of "';

export function isPriceChangedError(message: string | null): boolean {
  return message !== null && message.startsWith(PRICE_CHANGED_ERROR_PREFIX);
}

interface RepriceableCartLine {
  product_id: string;
  name: string;
  unit_price: number;
}

interface PricedProduct {
  id: string;
  selling_price: number;
}

export interface RepriceCartResult<L extends RepriceableCartLine> {
  cart: Record<string, L>;
  /** Names of lines dropped because the product is no longer for sale. */
  removedNames: string[];
}

/**
 * Every cart line gets the fresh selling_price of its product. A line whose
 * product is missing from `products` (inactive or no price any more) is
 * removed and reported in removedNames.
 */
export function repriceCart<L extends RepriceableCartLine>(
  cart: Record<string, L>,
  products: readonly PricedProduct[],
): RepriceCartResult<L> {
  const priceById = new Map(
    products.map((product) => [product.id, product.selling_price]),
  );
  const next: Record<string, L> = {};
  const removedNames: string[] = [];

  for (const [productId, line] of Object.entries(cart)) {
    const price = priceById.get(line.product_id);
    if (price === undefined) {
      removedNames.push(line.name);
      continue;
    }
    next[productId] = { ...line, unit_price: price };
  }

  return { cart: next, removedNames };
}

/** Message shown after a re-price: the SQL message + what was removed. */
export function describeReprice(
  priceError: string,
  removedNames: readonly string[],
): string {
  if (removedNames.length === 0) {
    return priceError;
  }

  return `${priceError} Removed from the cart (no longer for sale): ${removedNames.join(", ")}.`;
}
