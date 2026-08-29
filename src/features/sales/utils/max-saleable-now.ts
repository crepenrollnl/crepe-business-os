export const NO_BOM_BOTTLENECK_MESSAGE =
  "has no components defined and cannot be assembled";

export type SaleableNowBottleneckKind = "component" | "ingredient" | "no_bom";

export interface SaleableNowProduct {
  id: string;
  name: string;
}

export interface SaleableNowBomLine {
  assembly_recipe_id: string;
  component_recipe_id: string | null;
  ingredient_id: string | null;
  quantity: number;
  component_name: string | null;
  ingredient_name: string | null;
}

export interface SaleableNowRow {
  product_id: string;
  product_name: string;
  max_portions: number;
  bottleneck_name: string | null;
  bottleneck_kind: SaleableNowBottleneckKind | null;
}

function availableOrZero(
  map: ReadonlyMap<string, number>,
  key: string,
): number {
  const raw = map.get(key);
  if (raw === undefined || !Number.isFinite(raw) || raw < 0) {
    return 0;
  }
  return raw;
}

function lineLabel(line: SaleableNowBomLine): string {
  if (line.component_recipe_id) {
    const name = line.component_name?.trim();
    return name && name.length > 0 ? name : line.component_recipe_id;
  }

  if (line.ingredient_id) {
    const name = line.ingredient_name?.trim();
    return name && name.length > 0 ? name : line.ingredient_id;
  }

  return "Unknown";
}

function portionsForLine(
  line: SaleableNowBomLine,
  fgAvailableByProductId: ReadonlyMap<string, number>,
  stockByIngredientId: ReadonlyMap<string, number>,
): { portions: number; name: string; kind: SaleableNowBottleneckKind } {
  if (line.component_recipe_id) {
    const kind = "component" as const;
    const name = lineLabel(line);
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      return { portions: 0, name, kind };
    }
    return {
      portions: Math.floor(
        availableOrZero(fgAvailableByProductId, line.component_recipe_id) /
          line.quantity,
      ),
      name,
      kind,
    };
  }

  if (line.ingredient_id) {
    const kind = "ingredient" as const;
    const name = lineLabel(line);
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      return { portions: 0, name, kind };
    }
    return {
      portions: Math.floor(
        availableOrZero(stockByIngredientId, line.ingredient_id) /
          line.quantity,
      ),
      name,
      kind,
    };
  }

  return { portions: 0, name: lineLabel(line), kind: "component" };
}

/**
 * Mode A: how many portions confirm_sale can ship right now.
 * Uses finished-goods remaining for component_recipe_id rows and
 * ingredients.current_stock for ingredient_id rows. Does not hypothetically
 * produce missing components from raw materials.
 *
 * Products are independent: shared stock maps are not consumed between rows.
 */
export function computeMaxSaleableNow(
  products: readonly SaleableNowProduct[],
  bomLines: readonly SaleableNowBomLine[],
  fgAvailableByProductId: ReadonlyMap<string, number>,
  stockByIngredientId: ReadonlyMap<string, number>,
): SaleableNowRow[] {
  const linesByAssembly = new Map<string, SaleableNowBomLine[]>();

  for (const line of bomLines) {
    const lines = linesByAssembly.get(line.assembly_recipe_id);
    if (lines) {
      lines.push(line);
    } else {
      linesByAssembly.set(line.assembly_recipe_id, [line]);
    }
  }

  return products.map((product) => {
    const lines = linesByAssembly.get(product.id) ?? [];

    if (lines.length === 0) {
      return {
        product_id: product.id,
        product_name: product.name,
        max_portions: 0,
        bottleneck_name: NO_BOM_BOTTLENECK_MESSAGE,
        bottleneck_kind: "no_bom",
      };
    }

    let minPortions = Number.POSITIVE_INFINITY;
    let bottleneckName = lines[0] ? lineLabel(lines[0]) : null;
    let bottleneckKind: SaleableNowBottleneckKind = lines[0]?.component_recipe_id
      ? "component"
      : "ingredient";

    for (const line of lines) {
      const result = portionsForLine(
        line,
        fgAvailableByProductId,
        stockByIngredientId,
      );
      if (result.portions < minPortions) {
        minPortions = result.portions;
        bottleneckName = result.name;
        bottleneckKind = result.kind;
      }
    }

    return {
      product_id: product.id,
      product_name: product.name,
      max_portions: Number.isFinite(minPortions) ? minPortions : 0,
      bottleneck_name: bottleneckName,
      bottleneck_kind: bottleneckKind,
    };
  });
}
