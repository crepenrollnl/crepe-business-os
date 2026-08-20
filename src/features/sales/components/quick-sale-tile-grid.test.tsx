/**
 * Quick Sale / POS product tiles: photo on top, letter placeholder when
 * image_url is empty or the image fails to load.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { QuickSaleProduct } from "../hooks/use-quick-sale";
import { QuickSaleTileGrid } from "./quick-sale-tile-grid";

function product(
  overrides?: Partial<QuickSaleProduct>,
): QuickSaleProduct {
  return {
    id: "recipe-1",
    name: "Chicken Crepe",
    selling_price: 7.5,
    image_url: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("QuickSaleTileGrid photos", () => {
  it("renders the dish photo when image_url is set", () => {
    render(
      <QuickSaleTileGrid
        products={[
          product({
            image_url:
              "https://proj.supabase.co/storage/v1/object/public/recipe-photos/r/1.jpg",
          }),
        ]}
        loading={false}
        error={null}
        onTap={() => undefined}
      />,
    );

    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toContain("recipe-photos");
  });

  it("renders a letter placeholder when image_url is null", () => {
    render(
      <QuickSaleTileGrid
        products={[product({ name: "Nutella Banana Crepe", image_url: null })]}
        loading={false}
        error={null}
        onTap={() => undefined}
      />,
    );

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("N")).toBeInTheDocument();
  });

  it("switches to the letter placeholder when the image fails to load", () => {
    render(
      <QuickSaleTileGrid
        products={[
          product({
            image_url: "https://proj.supabase.co/broken.jpg",
          }),
        ]}
        loading={false}
        error={null}
        onTap={() => undefined}
      />,
    );

    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    fireEvent.error(img!);

    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("C")).toBeInTheDocument();
  });
});
