import { describe, expect, it } from "vitest";
import {
  RECEIPT_IMAGE_MAX_BYTES,
  RECEIPT_PHOTO_TOO_LARGE_MESSAGE,
  fitLongEdge,
  receiptImageTooLargeMessage,
} from "./prepare-receipt-image";

describe("fitLongEdge", () => {
  it("does not upscale a photo already within the long edge", () => {
    expect(fitLongEdge(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitLongEdge(2000, 1000)).toEqual({ width: 2000, height: 1000 });
  });

  it("scales the long edge down to 2000 and keeps the other edge in proportion", () => {
    expect(fitLongEdge(4000, 2000)).toEqual({ width: 2000, height: 1000 });
    expect(fitLongEdge(1000, 4000)).toEqual({ width: 500, height: 2000 });
  });

  it("rejects dimensions that cannot be drawn", () => {
    expect(() => fitLongEdge(0, 100)).toThrow(/not valid/);
  });
});

describe("receiptImageTooLargeMessage", () => {
  it("allows a JPEG at the 8 MB limit and refuses one byte over", () => {
    expect(receiptImageTooLargeMessage(RECEIPT_IMAGE_MAX_BYTES)).toBeNull();
    expect(receiptImageTooLargeMessage(RECEIPT_IMAGE_MAX_BYTES + 1)).toBe(
      RECEIPT_PHOTO_TOO_LARGE_MESSAGE,
    );
  });
});
