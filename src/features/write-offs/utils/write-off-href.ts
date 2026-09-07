import type { WriteOffItemType } from "../types/write-off";

export function writeOffPrefillHref(
  itemType: WriteOffItemType,
  itemId: string,
): string {
  const params = new URLSearchParams({
    tab: "write-offs",
    itemType,
    id: itemId,
  });
  return `/inventory?${params.toString()}`;
}

export function parseWriteOffPrefillItemType(
  value: string | null,
): WriteOffItemType | null {
  if (value === "ingredient" || value === "finished_good") {
    return value;
  }
  return null;
}
