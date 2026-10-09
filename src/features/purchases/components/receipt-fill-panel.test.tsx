import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type {
  ReceiptRecognitionRequestResult,
  ReceiptRecognitionResult,
} from "../types/receipt-recognition";

const { requestRecognition, matchReceiptLines } = vi.hoisted(() => ({
  requestRecognition: vi.fn(),
  matchReceiptLines: vi.fn(),
}));

vi.mock("../utils/request-receipt-recognition", () => ({
  requestReceiptRecognition: (...args: unknown[]) => requestRecognition(...args),
}));

vi.mock("../services/purchase-receipt-service", () => ({
  purchaseReceiptService: {
    matchReceiptLines: (...args: unknown[]) => matchReceiptLines(...args),
  },
}));

import { ReceiptFillPanel } from "./receipt-fill-panel";

const FLOUR = "ingredient-flour";

function recognition(overrides: Partial<ReceiptRecognitionResult> = {}): ReceiptRecognitionResult {
  return {
    schemaVersion: 1,
    readable: true,
    storeName: "Sligro",
    receiptDate: "2026-10-05",
    currency: "EUR",
    total: 7.75,
    lines: [
      { text: "MEEL", quantity: 1, unitPrice: 5, lineTotal: 5, vatRate: 9, kind: "item" },
      { text: "MELK", quantity: 2, unitPrice: 1.25, lineTotal: 2.5, vatRate: 9, kind: "item" },
      { text: "TAS", quantity: null, unitPrice: null, lineTotal: 0.25, vatRate: 21, kind: "bag" },
    ],
    ...overrides,
  };
}

function okResult(result: ReceiptRecognitionResult): ReceiptRecognitionRequestResult {
  return { status: "ok", cached: false, recognitionId: "recognition-1", result };
}

function renderPanel(supplierId = "supplier-1") {
  const onFill = vi.fn();
  render(
    <ReceiptFillPanel
      receiptId="receipt-1"
      supplierId={supplierId}
      knownIngredientIds={new Set([FLOUR])}
      disabled={false}
      onFill={onFill}
    />,
  );
  return onFill;
}

async function clickFill() {
  await userEvent.click(screen.getByRole("button", { name: "Fill lines from receipt" }));
}

describe("ReceiptFillPanel", () => {
  afterEach(() => {
    cleanup();
    requestRecognition.mockReset();
    matchReceiptLines.mockReset();
  });

  it("shows the reading text while waiting and does not force", async () => {
    let finish: (value: ReceiptRecognitionRequestResult) => void = () => undefined;
    requestRecognition.mockImplementation(
      () =>
        new Promise<ReceiptRecognitionRequestResult>((resolve) => {
          finish = resolve;
        }),
    );
    renderPanel();

    await clickFill();

    const button = screen.getByRole("button", { name: "Reading receipt… (10–20 s)" });
    expect(button).toBeDisabled();
    expect(requestRecognition).toHaveBeenCalledWith("receipt-1");

    finish({ status: "not_configured" });
    expect(await screen.findByText("Receipt reading is not set up.")).toBeInTheDocument();
  });

  it("explains when reading is not set up", async () => {
    requestRecognition.mockResolvedValue({ status: "not_configured" });
    const onFill = renderPanel();

    await clickFill();

    expect(await screen.findByRole("alert")).toHaveTextContent("Receipt reading is not set up.");
    expect(onFill).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Fill lines from receipt" })).toBeEnabled();
  });

  it("shows the server message on an error", async () => {
    requestRecognition.mockResolvedValue({
      status: "error",
      message: "Receipt reading is busy. Try again in a minute.",
    });
    const onFill = renderPanel();

    await clickFill();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Receipt reading is busy. Try again in a minute.",
    );
    expect(onFill).not.toHaveBeenCalled();
  });

  it("explains an unreadable photo", async () => {
    requestRecognition.mockResolvedValue(
      okResult(recognition({ readable: false, lines: [] })),
    );
    const onFill = renderPanel();

    await clickFill();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The photo could not be read. Enter the lines by hand.",
    );
    expect(onFill).not.toHaveBeenCalled();
    expect(matchReceiptLines).not.toHaveBeenCalled();
  });

  it("fills the lines, then shows the summary and the not-added list", async () => {
    requestRecognition.mockResolvedValue(okResult(recognition()));
    matchReceiptLines.mockResolvedValue({
      data: [
        { lineIndex: 1, action: "ingredient", ingredientId: FLOUR, unitsPerItem: 1 },
        { lineIndex: 2, action: null, ingredientId: null, unitsPerItem: null },
        { lineIndex: 3, action: null, ingredientId: null, unitsPerItem: null },
      ],
      error: null,
    });
    const onFill = renderPanel();

    await clickFill();

    expect(
      await screen.findByText("Receipt total €7.75 · added €7.50 · not added €0.25"),
    ).toBeInTheDocument();
    expect(matchReceiptLines).toHaveBeenCalledWith("supplier-1", ["MEEL", "MELK", "TAS"]);
    expect(onFill).toHaveBeenCalledTimes(1);
    const filled = onFill.mock.calls[0]?.[0] as Array<{ ingredientId: string; text?: string }>;
    expect(filled.map((row) => row.ingredientId)).toEqual([FLOUR, ""]);
    expect(screen.queryByRole("button", { name: "Fill lines from receipt" })).not.toBeInTheDocument();

    const list = screen.getByRole("list", { name: "Not added from receipt" });
    expect(list).toHaveTextContent("TAS · €0.25 · bag");

    await userEvent.click(screen.getByRole("button", { name: "Add TAS" }));

    expect(onFill).toHaveBeenCalledTimes(2);
    expect(onFill.mock.calls[1]?.[0]).toEqual([
      expect.objectContaining({ ingredientId: "", quantity: 1, lineTotal: 0.25 }),
    ]);
    expect(screen.queryByRole("button", { name: "Add TAS" })).not.toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
  });

  it("lists a discount it could not apply without an Add button", async () => {
    requestRecognition.mockResolvedValue(
      okResult(
        recognition({
          lines: [
            { text: "BONUS", quantity: null, unitPrice: null, lineTotal: -1, vatRate: 9, kind: "discount" },
            { text: "MEEL", quantity: 1, unitPrice: 5, lineTotal: 5, vatRate: 9, kind: "item" },
            { text: "TAS", quantity: null, unitPrice: null, lineTotal: 0.25, vatRate: 21, kind: "bag" },
          ],
        }),
      ),
    );
    matchReceiptLines.mockResolvedValue({ data: [], error: null });
    renderPanel();

    await clickFill();

    const list = await screen.findByRole("list", { name: "Not added from receipt" });
    expect(list).toHaveTextContent("BONUS · -€1.00 · discount");
    expect(screen.queryByRole("button", { name: "Add BONUS" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add TAS" })).toBeInTheDocument();
  });

  it("omits the receipt total when it was not printed", async () => {
    requestRecognition.mockResolvedValue(okResult(recognition({ total: null })));
    matchReceiptLines.mockResolvedValue({ data: [], error: null });
    renderPanel();

    await clickFill();

    expect(await screen.findByText("Added €7.50 · not added €0.25")).toBeInTheDocument();
  });

  it("treats every line as unknown without a supplier", async () => {
    requestRecognition.mockResolvedValue(okResult(recognition()));
    const onFill = renderPanel("");

    await clickFill();

    await waitFor(() => {
      expect(onFill).toHaveBeenCalledTimes(1);
    });
    expect(matchReceiptLines).not.toHaveBeenCalled();
    const filled = onFill.mock.calls[0]?.[0] as Array<{ ingredientId: string }>;
    expect(filled.every((row) => row.ingredientId === "")).toBe(true);
  });

  it("treats every line as unknown and says so when matching fails", async () => {
    requestRecognition.mockResolvedValue(okResult(recognition()));
    matchReceiptLines.mockResolvedValue({ data: null, error: "nope" });
    const onFill = renderPanel();

    await clickFill();

    expect(await screen.findByText("Could not load remembered lines.")).toBeInTheDocument();
    const filled = onFill.mock.calls[0]?.[0] as Array<{ ingredientId: string }>;
    expect(filled.every((row) => row.ingredientId === "")).toBe(true);
  });
});
