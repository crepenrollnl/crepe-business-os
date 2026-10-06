import { describe, expect, it } from "vitest";
import {
  buildDriveReceiptFileName,
  driveFoldersFromReceiptDate,
  sanitizeDriveFileName,
} from "./drive-receipt-copy";

describe("drive receipt file names", () => {
  it("builds a single-page name and a multi-page name from the receipt date", () => {
    expect(
      buildDriveReceiptFileName({
        receiptDate: "2026-10-05",
        supplierName: "Makro",
        receiptTotal: 13.2,
        pageNumber: 1,
        pageCount: 1,
        fileId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toBe("2026-10-05_Makro_13.20_22222222.jpg");

    expect(
      buildDriveReceiptFileName({
        receiptDate: "2026-10-05",
        supplierName: null,
        receiptTotal: null,
        pageNumber: 2,
        pageCount: 3,
        fileId: "abcdefabcdef",
      }),
    ).toBe("2026-10-05_no-supplier_no-total_p2_abcdefab.jpg");
  });

  it("strips characters that are invalid in file names and collapses whitespace", () => {
    expect(sanitizeDriveFileName("Foo/Bar\\Baz:\tQux  *?\"<>|")).toBe("Foo Bar Baz Qux");
    expect(
      buildDriveReceiptFileName({
        receiptDate: "2026-01-09",
        supplierName: "  Foo/Bar  ",
        receiptTotal: 0,
        pageNumber: 1,
        pageCount: 1,
        fileId: "123456789",
      }),
    ).toBe("2026-01-09_Foo Bar_0.00_12345678.jpg");
  });

  it("reads the year and month from the date string", () => {
    expect(driveFoldersFromReceiptDate("2026-10-05")).toEqual({
      root: "Receipts",
      year: "2026",
      month: "10",
    });
    expect(driveFoldersFromReceiptDate("2026-01-09")).toEqual({
      root: "Receipts",
      year: "2026",
      month: "01",
    });
    expect(driveFoldersFromReceiptDate("05-10-2026")).toBeNull();
  });
});
