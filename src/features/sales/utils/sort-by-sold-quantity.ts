export interface NamedProduct {
  name: string;
}

export interface RankableProduct extends NamedProduct {
  id: string;
}

export function sortByProductName<T extends NamedProduct>(
  products: readonly T[],
): T[] {
  return [...products].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/**
 * Rank tiles by sold quantity (highest first). Missing map keys are 0
 * (unsold products go last). Equal qty ties break A–Z by name.
 */
export function sortBySoldQuantity<T extends RankableProduct>(
  products: readonly T[],
  qtyByProductId: ReadonlyMap<string, number>,
): T[] {
  return [...products].sort((a, b) => {
    const qtyA = qtyByProductId.get(a.id) ?? 0;
    const qtyB = qtyByProductId.get(b.id) ?? 0;
    if (qtyA !== qtyB) {
      return qtyB - qtyA;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}
