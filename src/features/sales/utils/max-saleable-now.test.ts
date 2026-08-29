import { describe, expect, it } from "vitest";
import {
  NO_BOM_BOTTLENECK_MESSAGE,
  computeMaxSaleableNow,
  type SaleableNowBomLine,
  type SaleableNowProduct,
} from "./max-saleable-now";

const CHICKEN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SALMON = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SAUCE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DOUGH = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const CUCUMBER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const LETTUCE = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function product(id: string, name: string): SaleableNowProduct {
  return { id, name };
}

function componentLine(
  assemblyId: string,
  componentId: string,
  quantity: number,
  name: string,
): SaleableNowBomLine {
  return {
    assembly_recipe_id: assemblyId,
    component_recipe_id: componentId,
    ingredient_id: null,
    quantity,
    component_name: name,
    ingredient_name: null,
  };
}

function ingredientLine(
  assemblyId: string,
  ingredientId: string,
  quantity: number,
  name: string,
): SaleableNowBomLine {
  return {
    assembly_recipe_id: assemblyId,
    component_recipe_id: null,
    ingredient_id: ingredientId,
    quantity,
    component_name: null,
    ingredient_name: name,
  };
}

describe("computeMaxSaleableNow", () => {
  it("takes the min across component lines and names the bottleneck", () => {
    const rows = computeMaxSaleableNow(
      [product(CHICKEN, "Chicken Crepe")],
      [
        componentLine(CHICKEN, SAUCE, 1, "Sauce"),
        componentLine(CHICKEN, DOUGH, 2, "Dough"),
      ],
      new Map([
        [SAUCE, 10],
        [DOUGH, 6],
      ]),
      new Map(),
    );

    expect(rows).toEqual([
      {
        product_id: CHICKEN,
        product_name: "Chicken Crepe",
        max_portions: 3,
        bottleneck_name: "Dough",
        bottleneck_kind: "component",
      },
    ]);
  });

  it("floors ingredient add-in availability", () => {
    const rows = computeMaxSaleableNow(
      [product(CHICKEN, "Chicken Crepe")],
      [ingredientLine(CHICKEN, CUCUMBER, 2, "Cucumber")],
      new Map(),
      new Map([[CUCUMBER, 5]]),
    );

    expect(rows[0]?.max_portions).toBe(2);
    expect(rows[0]?.bottleneck_kind).toBe("ingredient");
    expect(rows[0]?.bottleneck_name).toBe("Cucumber");
  });

  it("floors a fractional component ratio", () => {
    const rows = computeMaxSaleableNow(
      [product(CHICKEN, "Chicken Crepe")],
      [componentLine(CHICKEN, SAUCE, 2, "Sauce")],
      new Map([[SAUCE, 7.9]]),
      new Map(),
    );

    expect(rows[0]?.max_portions).toBe(3);
  });

  it("uses 0 availability when the FG map has no key", () => {
    const rows = computeMaxSaleableNow(
      [product(CHICKEN, "Chicken Crepe")],
      [componentLine(CHICKEN, SAUCE, 1, "Sauce")],
      new Map(),
      new Map(),
    );

    expect(rows[0]?.max_portions).toBe(0);
    expect(rows[0]?.bottleneck_name).toBe("Sauce");
    expect(rows[0]?.bottleneck_kind).toBe("component");
  });

  it("treats negative remaining as 0", () => {
    const rows = computeMaxSaleableNow(
      [product(CHICKEN, "Chicken Crepe")],
      [
        componentLine(CHICKEN, SAUCE, 1, "Sauce"),
        ingredientLine(CHICKEN, CUCUMBER, 1, "Cucumber"),
      ],
      new Map([[SAUCE, -4]]),
      new Map([[CUCUMBER, 20]]),
    );

    expect(rows[0]?.max_portions).toBe(0);
    expect(rows[0]?.bottleneck_name).toBe("Sauce");
  });

  it("returns no_bom when the assembly has no recipe_components", () => {
    const rows = computeMaxSaleableNow(
      [product(CHICKEN, "Chicken Crepe")],
      [],
      new Map(),
      new Map(),
    );

    expect(rows).toEqual([
      {
        product_id: CHICKEN,
        product_name: "Chicken Crepe",
        max_portions: 0,
        bottleneck_name: NO_BOM_BOTTLENECK_MESSAGE,
        bottleneck_kind: "no_bom",
      },
    ]);
  });

  it("keeps the first line as bottleneck when two lines tie", () => {
    const rows = computeMaxSaleableNow(
      [product(CHICKEN, "Chicken Crepe")],
      [
        componentLine(CHICKEN, SAUCE, 1, "Sauce"),
        componentLine(CHICKEN, DOUGH, 1, "Dough"),
      ],
      new Map([
        [SAUCE, 4],
        [DOUGH, 4],
      ]),
      new Map(),
    );

    expect(rows[0]?.max_portions).toBe(4);
    expect(rows[0]?.bottleneck_name).toBe("Sauce");
    expect(rows[0]?.bottleneck_kind).toBe("component");
  });

  it("does not share a pool between products that use the same component", () => {
    const fg = new Map([[SAUCE, 4]]);
    const rows = computeMaxSaleableNow(
      [product(CHICKEN, "Chicken Crepe"), product(SALMON, "Salmon Crepe")],
      [
        componentLine(CHICKEN, SAUCE, 1, "Sauce"),
        componentLine(SALMON, SAUCE, 1, "Sauce"),
      ],
      fg,
      new Map(),
    );

    expect(rows.map((row) => row.max_portions)).toEqual([4, 4]);
    expect(fg.get(SAUCE)).toBe(4);
  });

  it("mixes FG and ingredient lines and reports the tighter constraint", () => {
    const rows = computeMaxSaleableNow(
      [product(CHICKEN, "Chicken Crepe")],
      [
        componentLine(CHICKEN, SAUCE, 1, "Sauce"),
        ingredientLine(CHICKEN, LETTUCE, 3, "Lettuce"),
      ],
      new Map([[SAUCE, 10]]),
      new Map([[LETTUCE, 5]]),
    );

    expect(rows[0]?.max_portions).toBe(1);
    expect(rows[0]?.bottleneck_name).toBe("Lettuce");
    expect(rows[0]?.bottleneck_kind).toBe("ingredient");
  });
});
