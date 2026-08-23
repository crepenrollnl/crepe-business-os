export function formatFinishedGoodsQuantity(value: number): string {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(3).replace(/\.?0+$/, "");
}

export function formatFinishedGoodsAvailable(
  quantity: number,
  yieldUnit: string | null,
): string {
  const formatted = formatFinishedGoodsQuantity(quantity);
  if (!yieldUnit) {
    return formatted;
  }

  return `${formatted} ${yieldUnit}`;
}
