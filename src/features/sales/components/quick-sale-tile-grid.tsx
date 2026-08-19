"use client";

import { useState } from "react";
import { formatSaleMoney } from "../utils/format-sale";
import type { QuickSaleProduct } from "../hooks/use-quick-sale";

type QuickSaleTileGridProps = {
  products: QuickSaleProduct[];
  loading: boolean;
  error: string | null;
  onTap: (product: QuickSaleProduct) => void;
};

const TILE_PHOTO_HEIGHT_CLASS = "h-24";

function tileInitial(name: string): string {
  const letter = name.trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

function TilePhoto({
  imageUrl,
  name,
}: {
  imageUrl: string | null;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(imageUrl) && !failed;

  if (showImage && imageUrl) {
    return (
      // Public Storage URLs are not in next.config images.remotePatterns.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        className={`${TILE_PHOTO_HEIGHT_CLASS} w-full object-cover`}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={`flex ${TILE_PHOTO_HEIGHT_CLASS} w-full items-center justify-center bg-amber-100 text-2xl font-semibold text-amber-800`}
      aria-hidden
    >
      {tileInitial(name)}
    </div>
  );
}

export function QuickSaleTileGrid({
  products,
  loading,
  error,
  onTap,
}: QuickSaleTileGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="min-h-28 overflow-hidden rounded-xl bg-zinc-100"
          >
            <div className={`${TILE_PHOTO_HEIGHT_CLASS} animate-pulse bg-zinc-200`} />
            <div className="min-h-16 animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-8 text-center">
        <p className="text-sm font-medium text-zinc-900">
          No products available for Quick Sale
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          Set a selling price on an active assembly recipe in Recipes to make
          it tappable here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product) => (
        <button
          key={product.id}
          type="button"
          onClick={() => onTap(product)}
          className="flex min-h-28 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-left shadow-sm transition-colors hover:border-amber-400 hover:bg-amber-50"
        >
          <TilePhoto
            key={product.image_url ?? "none"}
            imageUrl={product.image_url}
            name={product.name}
          />
          <span className="flex flex-1 flex-col items-start justify-center gap-1 p-5">
            <span className="text-base font-medium text-zinc-900">
              {product.name}
            </span>
            <span className="text-sm font-semibold text-amber-700">
              {formatSaleMoney(product.selling_price)}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
