import { describe, expect, it } from "vitest";
import {
  sortByProductName,
  sortBySoldQuantity,
} from "./sort-by-sold-quantity";

interface Tile {
  id: string;
  name: string;
}

function tile(id: string, name: string): Tile {
  return { id, name };
}

describe("sortByProductName", () => {
  it("sorts A–Z with base sensitivity and does not mutate the input", () => {
    const input = [tile("2", "Test 001"), tile("1", "Apple crepe")];

    const sorted = sortByProductName(input);

    expect(sorted.map((item) => item.name)).toEqual([
      "Apple crepe",
      "Test 001",
    ]);
    expect(input.map((item) => item.name)).toEqual(["Test 001", "Apple crepe"]);
  });
});

describe("sortBySoldQuantity", () => {
  it("ranks higher qty first", () => {
    const chicken = tile("c", "Chicken crepe");
    const apple = tile("a", "Apple crepe");
    const qty = new Map<string, number>([
      ["c", 10],
      ["a", 2],
    ]);

    expect(sortBySoldQuantity([apple, chicken], qty).map((item) => item.id)).toEqual(
      ["c", "a"],
    );
  });

  it("puts unsold products after sold ones, then A–Z", () => {
    const apple = tile("a", "Apple crepe");
    const fanta = tile("f", "Fanta");
    const lemonade = tile("l", "Lemonade");
    const qty = new Map<string, number>([["a", 6]]);

    expect(
      sortBySoldQuantity([lemonade, apple, fanta], qty).map((item) => item.name),
    ).toEqual(["Apple crepe", "Fanta", "Lemonade"]);
  });

  it("breaks equal qty with A–Z name", () => {
    const zebra = tile("z", "Zebra crepe");
    const apple = tile("a", "Apple crepe");
    const qty = new Map<string, number>([
      ["z", 4],
      ["a", 4],
    ]);

    expect(sortBySoldQuantity([zebra, apple], qty).map((item) => item.name)).toEqual(
      ["Apple crepe", "Zebra crepe"],
    );
  });

  it("treats a missing map key as 0", () => {
    const sold = tile("s", "Sold crepe");
    const unsold = tile("u", "Unsold crepe");
    const qty = new Map<string, number>([["s", 1]]);

    expect(sortBySoldQuantity([unsold, sold], qty).map((item) => item.id)).toEqual(
      ["s", "u"],
    );
  });

  it("does not mutate the input array", () => {
    const apple = tile("a", "Apple crepe");
    const chicken = tile("c", "Chicken crepe");
    const input = [apple, chicken];
    const qty = new Map<string, number>([
      ["c", 10],
      ["a", 2],
    ]);

    sortBySoldQuantity(input, qty);

    expect(input).toEqual([apple, chicken]);
  });
});
