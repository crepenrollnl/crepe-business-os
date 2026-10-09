import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { formatMoney } from "@/lib/money";
import type { PurchaseFormValues, PurchaseWithRelations } from "../types/purchase";
import type { PurchaseReceiptCard } from "../types/purchase-receipt";
import { purchaseReceiptService } from "../services/purchase-receipt-service";
import { formatReceiptDisplayDate } from "../utils/receipt-purchase-link";
import { draftToValues, PurchaseDocumentModal } from "./purchase-document-modal";

const getLastPurchaseLines = vi.fn();

vi.mock("../services/purchase-service", () => ({
  purchaseService: {
    getLastPurchaseLines: (...args: unknown[]) => getLastPurchaseLines(...args),
  },
}));

vi.mock("../services/purchase-tax-service", () => ({
  purchaseTaxService: {
    calculatePurchaseTaxes: vi.fn().mockResolvedValue({
      data: null,
      error: null,
    }),
    previewPurchaseTaxes: vi.fn().mockResolvedValue({
      data: null,
      error: null,
    }),
  },
}));

vi.mock("@/features/auth/services/auth-service", () => ({
  authService: {
    getMyRole: () => Promise.resolve("seller"),
  },
}));

vi.mock("../services/purchase-receipt-service", () => ({
  purchaseReceiptService: {
    listForPurchase: vi.fn(),
    listUnassigned: vi.fn(),
    listActiveSuppliers: vi.fn(),
    linkToPurchase: vi.fn(),
    unlinkFromPurchase: vi.fn(),
    signStoragePaths: vi.fn(),
    update: vi.fn(),
    discard: vi.fn(),
    save: vi.fn(),
    countUnassigned: vi.fn(),
    listRecent: vi.fn(),
    matchReceiptLines: vi.fn(),
    rememberReceiptLineMapping: vi.fn(),
  },
}));

const { requestRecognition } = vi.hoisted(() => ({ requestRecognition: vi.fn() }));

vi.mock("../utils/request-receipt-recognition", () => ({
  requestReceiptRecognition: (...args: unknown[]) => requestRecognition(...args),
}));

const INGREDIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INGREDIENT_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SUPPLIER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUPPLIER_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

interface SnapshotInput {
  enteredUnitPrice: number;
  priceMode: "inclusive" | "exclusive";
  taxCategory: string;
  taxRegime: string;
  supplierId: string;
  supplierName: string;
}

function snapshot(input: SnapshotInput) {
  return {
    enteredUnitPrice: input.enteredUnitPrice,
    unitCost: input.enteredUnitPrice,
    priceMode: input.priceMode,
    taxCategory: input.taxCategory,
    taxRegime: input.taxRegime,
    purchasedAt: "2026-09-26T12:00:00.000Z",
    supplierId: input.supplierId,
    supplierName: input.supplierName,
  };
}

function lastLineResponse() {
  return {
    data: [
      {
        ingredientId: INGREDIENT_ID,
        supplierLine: {
          enteredUnitPrice: 14.68,
          unitCost: 13.47,
          priceMode: "inclusive" as const,
          taxCategory: "food",
          taxRegime: "reduced_vat",
          purchasedAt: "2026-09-26T12:00:00.000Z",
          supplierId: SUPPLIER_ID,
          supplierName: "Makro",
        },
        anyLine: null,
      },
    ],
    error: null,
  };
}

function draftPurchase(): PurchaseWithRelations {
  return {
    id: "purchase-1",
    supplier_id: SUPPLIER_ID,
    status: "draft",
    invoice_number: null,
    notes: null,
    subtotal: 0,
    tax_total: 0,
    total: 0,
    currency: "EUR",
    purchased_at: "2026-09-26T12:00:00.000Z",
    transaction_id: null,
    production_plan_id: "plan-1",
    tax_country: "NL",
    supplier_country: "NL",
    created_at: "2026-09-26T12:00:00.000Z",
    supplier: { id: SUPPLIER_ID, name: "Makro" },
    items: [
      {
        id: "item-1",
        purchase_id: "purchase-1",
        ingredient_id: INGREDIENT_ID,
        quantity: 2,
        unit_cost: 0,
        line_total: 0,
        tax_category: "food",
        tax_regime: "reduced_vat",
        price_mode: "inclusive",
        entered_unit_price: 0,
        discount: 0,
        ingredient: { id: INGREDIENT_ID, name: "Flour", unit: "kg" },
      },
    ],
  };
}

function renderModal(
  purchase: PurchaseWithRelations | null,
  overrides?: { ingredientId?: string; unitCost?: number },
) {
  const ingredientId = overrides?.ingredientId ?? INGREDIENT_ID;
  const unitCost = overrides?.unitCost ?? 0;
  const initialLines = purchase
    ? [
        {
          ingredient_id: ingredientId,
          quantity: 2,
          unit_cost: unitCost,
          discount: 0,
          tax_category: "food",
          tax_regime: "reduced_vat",
          price_mode: "inclusive" as const,
        },
      ]
    : [
        {
          ingredient_id: ingredientId,
          quantity: 1,
          unit_cost: unitCost,
          discount: 0,
          tax_category: "food",
          tax_regime: "reduced_vat",
          price_mode: "inclusive" as const,
        },
      ];

  render(
    <PurchaseDocumentModal
      isOpen
      purchase={purchase}
      initialValues={{
        supplier_id: SUPPLIER_ID,
        invoice_number: "",
        purchased_at: "2026-09-26",
        notes: "",
        supplier_country: "NL",
        tax_country: "NL",
        lines: initialLines,
      }}
      suppliers={[
        { id: SUPPLIER_ID, name: "Makro" },
        { id: SUPPLIER_B, name: "Sligro" },
      ]}
      ingredients={[
        { id: INGREDIENT_ID, name: "Flour", unit: "kg" },
        { id: INGREDIENT_B, name: "Milk", unit: "L" },
      ]}
      isLoading={false}
      isSaving={false}
      error={null}
      onClose={() => undefined}
      onSaveDraft={async () => true}
      onReceiveGoods={async () => true}
    />,
  );
}

describe("PurchaseDocumentModal last price", () => {
  afterEach(() => {
    cleanup();
    getLastPurchaseLines.mockReset();
  });

  it("lets Use replace a price the user already typed", async () => {
    getLastPurchaseLines.mockResolvedValue(lastLineResponse());
    renderModal(null);

    const useHint = await screen.findByRole("button", { name: /Use$/ });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "14.68",
      );
    });
    const unitPrice = screen.getByRole("textbox", { name: "Unit price" });
    fireEvent.change(unitPrice, { target: { value: "3" } });
    expect(unitPrice).toHaveValue("3");

    fireEvent.click(useHint);

    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
      "14.68",
    );
  });

  it("fills only an empty-or-zero loaded line and reports the count", async () => {
    getLastPurchaseLines.mockResolvedValue(lastLineResponse());
    renderModal(draftPurchase());

    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
      "0",
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Fill last prices" }),
    );

    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
      "14.68",
    );
    expect(screen.getByText("Filled 1 of 1 lines")).toBeInTheDocument();
  });

  function oilAndCucumberHistory() {
    getLastPurchaseLines.mockImplementation(async (ids: string[]) => ({
      data: ids.map((id) => ({
        ingredientId: id,
        supplierLine: null,
        anyLine: snapshot({
          enteredUnitPrice: id === INGREDIENT_B ? 1.29 : 1.725,
          priceMode: "inclusive",
          taxCategory: "food",
          taxRegime: "reduced_vat",
          supplierId: SUPPLIER_B,
          supplierName: "Aldi",
        }),
      })),
      error: null,
    }));
  }

  it("replaces a prefilled price after quantity and focusing the price field", async () => {
    oilAndCucumberHistory();
    renderModal(null);

    const unitPrice = await screen.findByRole("textbox", { name: "Unit price" });
    await waitFor(() => {
      expect(unitPrice).toHaveValue("1.725");
    });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "1" } });
    expect(screen.getByRole("textbox", { name: "Line total" })).toHaveValue("1.73");
    fireEvent.focus(unitPrice);
    fireEvent.blur(unitPrice);
    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_B } });

    await waitFor(() => {
      expect(unitPrice).toHaveValue("1.29");
    });
    expect(screen.getByRole("textbox", { name: "Line total" })).toHaveValue("1.29");
    expect(screen.getByRole("button", { name: /Use$/ })).toHaveTextContent(
      /other supplier: Aldi/,
    );
  });

  it("replaces a price after the hint is clicked and the ingredient changes", async () => {
    oilAndCucumberHistory();
    renderModal(null);

    const unitPrice = await screen.findByRole("textbox", { name: "Unit price" });
    await waitFor(() => {
      expect(unitPrice).toHaveValue("1.725");
    });
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "1" } });
    fireEvent.click(await screen.findByRole("button", { name: /Use$/ }));
    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_B } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Use$/ })).toHaveTextContent(/1\.29/);
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "1.29",
      );
    });
    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
      "1.29",
    );
    expect(screen.getByRole("textbox", { name: "Line total" })).toHaveValue("1.29");
  });

  it("fills a price the user typed and then cleared", async () => {
    getLastPurchaseLines.mockResolvedValue(lastLineResponse());
    renderModal(null);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "14.68",
      );
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Unit price" }), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Unit price" }), {
      target: { value: "" },
    });
    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue("");

    fireEvent.click(
      await screen.findByRole("button", { name: "Fill last prices" }),
    );

    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
      "14.68",
    );
    expect(screen.getByText("Filled 1 of 1 lines")).toBeInTheDocument();
  });

  it("clears a helper price when the next ingredient has no history", async () => {
    getLastPurchaseLines.mockImplementation(async (ids: string[]) => ({
      data: ids.map((id) =>
        id === INGREDIENT_ID
          ? {
              ingredientId: id,
              supplierLine: snapshot({
                enteredUnitPrice: 14.68,
                priceMode: "exclusive",
                taxCategory: "goods",
                taxRegime: "standard_vat",
                supplierId: SUPPLIER_ID,
                supplierName: "Makro",
              }),
              anyLine: null,
            }
          : { ingredientId: id, supplierLine: null, anyLine: null },
      ),
      error: null,
    }));
    renderModal(null);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "14.68",
      );
    });
    expect(screen.getByRole("checkbox", { name: "Includes tax" })).not.toBeChecked();
    expect(taxSelect("food").value).toBe("goods");
    expect(taxSelect("reduced_vat").value).toBe("standard_vat");

    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_B } });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue("");
    });
    expect(screen.getByRole("checkbox", { name: "Includes tax" })).toBeChecked();
    expect(taxSelect("food").value).toBe("food");
    expect(taxSelect("reduced_vat").value).toBe("reduced_vat");
  });

  it("replaces a helper price with the next ingredient's history", async () => {
    getLastPurchaseLines.mockImplementation(async (ids: string[]) => ({
      data: ids.map((id) => ({
        ingredientId: id,
        supplierLine: snapshot(
          id === INGREDIENT_B
            ? {
                enteredUnitPrice: 20,
                priceMode: "exclusive",
                taxCategory: "goods",
                taxRegime: "standard_vat",
                supplierId: SUPPLIER_ID,
                supplierName: "Makro",
              }
            : {
                enteredUnitPrice: 14.68,
                priceMode: "inclusive",
                taxCategory: "food",
                taxRegime: "reduced_vat",
                supplierId: SUPPLIER_ID,
                supplierName: "Makro",
              },
        ),
        anyLine: null,
      })),
      error: null,
    }));
    renderModal(null);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "14.68",
      );
    });

    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_B } });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "20",
      );
    });
    expect(screen.getByRole("checkbox", { name: "Includes tax" })).not.toBeChecked();
    expect(taxSelect("food").value).toBe("goods");
    expect(taxSelect("reduced_vat").value).toBe("standard_vat");
  });

  it("replaces a price the user typed when the ingredient changes", async () => {
    getLastPurchaseLines.mockImplementation(async (ids: string[]) => ({
      data: ids.map((id) => ({
        ingredientId: id,
        supplierLine: snapshot({
          enteredUnitPrice: id === INGREDIENT_B ? 20 : 14.68,
          priceMode: "inclusive",
          taxCategory: "food",
          taxRegime: "reduced_vat",
          supplierId: SUPPLIER_ID,
          supplierName: "Makro",
        }),
        anyLine: null,
      })),
      error: null,
    }));
    renderModal(null);

    const unitPrice = await screen.findByRole("textbox", { name: "Unit price" });
    await waitFor(() => {
      expect(unitPrice).toHaveValue("14.68");
    });
    fireEvent.change(unitPrice, { target: { value: "3" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Discount" }), {
      target: { value: "2" },
    });
    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_B } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Use$/ })).toHaveTextContent(
        /20/,
      );
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "20",
      );
    });
    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue("20");
    expect(screen.getByRole("textbox", { name: "Discount" })).toHaveValue("2");
  });

  it("clears a typed price and user tax when the next ingredient has no history", async () => {
    getLastPurchaseLines.mockImplementation(async (ids: string[]) => ({
      data: ids.map((id) =>
        id === INGREDIENT_ID
          ? {
              ingredientId: id,
              supplierLine: snapshot({
                enteredUnitPrice: 14.68,
                priceMode: "exclusive",
                taxCategory: "goods",
                taxRegime: "standard_vat",
                supplierId: SUPPLIER_ID,
                supplierName: "Makro",
              }),
              anyLine: null,
            }
          : { ingredientId: id, supplierLine: null, anyLine: null },
      ),
      error: null,
    }));
    renderModal(null);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "14.68",
      );
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Unit price" }), {
      target: { value: "3" },
    });
    fireEvent.change(taxSelect("goods"), { target: { value: "alcohol" } });
    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_B } });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue("");
    });
    expect(screen.getByRole("checkbox", { name: "Includes tax" })).toBeChecked();
    expect(taxSelect("food").value).toBe("food");
    expect(taxSelect("reduced_vat").value).toBe("reduced_vat");
  });

  it("keeps a price typed before the first ingredient is picked", async () => {
    getLastPurchaseLines.mockResolvedValue(lastLineResponse());
    renderModal(null, { ingredientId: "" });

    fireEvent.change(screen.getByRole("textbox", { name: "Unit price" }), {
      target: { value: "3" },
    });
    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_ID } });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Use$/ })).toBeInTheDocument();
    });
    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue("3");
  });

  it("replaces a loaded line's price when its ingredient changes", async () => {
    getLastPurchaseLines.mockImplementation(async (ids: string[]) => ({
      data: ids.map((id) => ({
        ingredientId: id,
        supplierLine: snapshot({
          enteredUnitPrice: id === INGREDIENT_B ? 1.29 : 5,
          priceMode: "inclusive",
          taxCategory: "food",
          taxRegime: "reduced_vat",
          supplierId: SUPPLIER_ID,
          supplierName: "Makro",
        }),
        anyLine: null,
      })),
      error: null,
    }));
    renderModal(draftPurchase(), { unitCost: 5 });

    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue("5");
    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_B } });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "1.29",
      );
    });
  });

  it("does not apply a supplier line fetched for the previous supplier", async () => {
    let releaseNext: (value: unknown) => void = () => undefined;
    getLastPurchaseLines
      .mockResolvedValueOnce({
        data: [
          {
            ingredientId: INGREDIENT_ID,
            supplierLine: snapshot({
              enteredUnitPrice: 14.68,
              priceMode: "inclusive",
              taxCategory: "food",
              taxRegime: "reduced_vat",
              supplierId: SUPPLIER_ID,
              supplierName: "Makro",
            }),
            anyLine: snapshot({
              enteredUnitPrice: 20,
              priceMode: "exclusive",
              taxCategory: "goods",
              taxRegime: "standard_vat",
              supplierId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              supplierName: "Hanos",
            }),
          },
        ],
        error: null,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseNext = resolve;
          }),
      );
    renderModal(null);

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "14.68",
      );
    });
    expect(screen.getByRole("button", { name: /Use$/ })).not.toHaveTextContent(
      /other supplier/,
    );

    fireEvent.change(screen.getByLabelText("Supplier"), {
      target: { value: SUPPLIER_B },
    });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "20",
      );
    });
    expect(screen.getByRole("button", { name: /Use$/ })).toHaveTextContent(
      /other supplier: Hanos/,
    );
    expect(screen.getByRole("button", { name: /Use$/ })).not.toHaveTextContent(
      /14\.68/,
    );

    releaseNext({
      data: [
        {
          ingredientId: INGREDIENT_ID,
          supplierLine: snapshot({
            enteredUnitPrice: 9,
            priceMode: "inclusive",
            taxCategory: "food",
            taxRegime: "reduced_vat",
            supplierId: SUPPLIER_B,
            supplierName: "Sligro",
          }),
          anyLine: null,
        },
      ],
      error: null,
    });

    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "9",
      );
    });
    expect(screen.getByRole("button", { name: /Use$/ })).not.toHaveTextContent(
      /other supplier/,
    );
  });

  it("drops the stored lookup when the refetch fails", async () => {
    getLastPurchaseLines
      .mockResolvedValueOnce({
        data: [
          {
            ingredientId: INGREDIENT_ID,
            supplierLine: snapshot({
              enteredUnitPrice: 14.68,
              priceMode: "inclusive",
              taxCategory: "food",
              taxRegime: "reduced_vat",
              supplierId: SUPPLIER_ID,
              supplierName: "Makro",
            }),
            anyLine: snapshot({
              enteredUnitPrice: 20,
              priceMode: "exclusive",
              taxCategory: "goods",
              taxRegime: "standard_vat",
              supplierId: SUPPLIER_B,
              supplierName: "Sligro",
            }),
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: "lookup failed" });
    renderModal(null);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Use$/ })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Supplier"), {
      target: { value: SUPPLIER_B },
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /Use$/ }),
      ).not.toBeInTheDocument();
    });
  });

  async function settlePastLineTotalProbe() {
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  it("keeps a typed line total and the unit price derived from it", async () => {
    getLastPurchaseLines.mockResolvedValue(lastLineResponse());
    renderModal(null, { ingredientId: "" });

    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_ID } });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "14.68",
      );
    });
    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Line total" }), {
      target: { value: "10" },
    });

    await settlePastLineTotalProbe();

    expect(screen.getByRole("textbox", { name: "Line total" })).toHaveValue("10");
    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue("5");
  });

  it("keeps a cleared line total empty", async () => {
    getLastPurchaseLines.mockResolvedValue(lastLineResponse());
    renderModal(null, { ingredientId: "" });

    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_ID } });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "14.68",
      );
    });
    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Line total" }), {
      target: { value: "" },
    });

    await settlePastLineTotalProbe();

    expect(screen.getByRole("textbox", { name: "Line total" })).toHaveValue("");
  });

  it("keeps a line total edited after Fill last prices", async () => {
    getLastPurchaseLines.mockResolvedValue(lastLineResponse());
    renderModal(draftPurchase());

    fireEvent.click(
      await screen.findByRole("button", { name: "Fill last prices" }),
    );
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "14.68",
      );
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Line total" }), {
      target: { value: "10" },
    });

    await settlePastLineTotalProbe();

    expect(screen.getByRole("textbox", { name: "Line total" })).toHaveValue("10");
    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue("5");
  });

  it("keeps a line total edited after a loaded line's ingredient change", async () => {
    getLastPurchaseLines.mockImplementation(async (ids: string[]) => ({
      data: ids.map((id) => ({
        ingredientId: id,
        supplierLine: snapshot({
          enteredUnitPrice: id === INGREDIENT_B ? 1.29 : 14.68,
          priceMode: "inclusive",
          taxCategory: "food",
          taxRegime: "reduced_vat",
          supplierId: SUPPLIER_ID,
          supplierName: "Makro",
        }),
        anyLine: null,
      })),
      error: null,
    }));
    renderModal(draftPurchase());

    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_B } });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "1.29",
      );
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Line total" }), {
      target: { value: "10" },
    });

    await settlePastLineTotalProbe();

    expect(screen.getByRole("textbox", { name: "Line total" })).toHaveValue("10");
    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue("5");
  });

  it("does not rewrite a line after an unrelated field edit", async () => {
    getLastPurchaseLines.mockResolvedValue(lastLineResponse());
    renderModal(null, { ingredientId: "" });

    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_ID } });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "14.68",
      );
    });
    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Line total" }), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Discount" }), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "delivery note" },
    });

    await settlePastLineTotalProbe();

    expect(screen.getByRole("textbox", { name: "Line total" })).toHaveValue("10");
    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue("5");
    expect(screen.getByRole("textbox", { name: "Discount" })).toHaveValue("2");
  });

  it("keeps Includes tax after the user unchecks it", async () => {
    getLastPurchaseLines.mockResolvedValue(lastLineResponse());
    renderModal(null, { ingredientId: "" });

    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_ID } });
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Includes tax" })).toBeChecked();
    });

    fireEvent.click(screen.getByRole("checkbox", { name: "Includes tax" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Discount" }), {
      target: { value: "1" },
    });

    await settlePastLineTotalProbe();

    expect(
      screen.getByRole("checkbox", { name: "Includes tax" }),
    ).not.toBeChecked();
  });

  it("keeps a tax category the user selected", async () => {
    getLastPurchaseLines.mockResolvedValue(lastLineResponse());
    renderModal(null, { ingredientId: "" });

    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_ID } });
    await waitFor(() => {
      expect(taxSelect("food").value).toBe("food");
    });

    fireEvent.change(taxSelect("alcohol"), { target: { value: "alcohol" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Discount" }), {
      target: { value: "1" },
    });

    await settlePastLineTotalProbe();

    expect(taxSelect("alcohol").value).toBe("alcohol");
  });

  it("keeps a tax regime the user selected", async () => {
    getLastPurchaseLines.mockResolvedValue(lastLineResponse());
    renderModal(null, { ingredientId: "" });

    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_ID } });
    await waitFor(() => {
      expect(taxSelect("reduced_vat").value).toBe("reduced_vat");
    });

    fireEvent.change(taxSelect("zero_rate"), { target: { value: "zero_rate" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Discount" }), {
      target: { value: "1" },
    });

    await settlePastLineTotalProbe();

    expect(taxSelect("zero_rate").value).toBe("zero_rate");
  });

  it("leaves a line-total price alone when the supplier changes", async () => {
    getLastPurchaseLines
      .mockResolvedValueOnce(lastLineResponse())
      .mockResolvedValueOnce({
        data: [
          {
            ingredientId: INGREDIENT_ID,
            supplierLine: snapshot({
              enteredUnitPrice: 9,
              priceMode: "inclusive",
              taxCategory: "food",
              taxRegime: "reduced_vat",
              supplierId: SUPPLIER_B,
              supplierName: "Sligro",
            }),
            anyLine: null,
          },
        ],
        error: null,
      });
    renderModal(null, { ingredientId: "" });

    fireEvent.change(ingredientSelect(), { target: { value: INGREDIENT_ID } });
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue(
        "14.68",
      );
    });
    fireEvent.change(screen.getByPlaceholderText("0"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Line total" }), {
      target: { value: "10" },
    });

    fireEvent.change(screen.getByLabelText("Supplier"), {
      target: { value: SUPPLIER_B },
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Use$/ })).toHaveTextContent(
        /Sligro/,
      );
    });
    await settlePastLineTotalProbe();

    expect(screen.getByRole("textbox", { name: "Line total" })).toHaveValue("10");
    expect(screen.getByRole("textbox", { name: "Unit price" })).toHaveValue("5");
  });
});

describe("PurchaseDocumentModal phone layout", () => {
  afterEach(() => {
    cleanup();
    getLastPurchaseLines.mockReset();
  });

  function renderLines(
    lines: Array<{
      ingredient_id: string;
      quantity: number;
      unit_cost: number;
      discount: number;
      tax_category: string;
      tax_regime: string;
      price_mode: "inclusive" | "exclusive";
    }>,
    isSaving = false,
  ) {
    getLastPurchaseLines.mockResolvedValue({ data: [], error: null });
    render(
      <PurchaseDocumentModal
        isOpen
        purchase={null}
        initialValues={{
          supplier_id: SUPPLIER_ID,
          invoice_number: "",
          purchased_at: "2026-09-26",
          notes: "",
          supplier_country: "NL",
          tax_country: "NL",
          lines,
        }}
        suppliers={[{ id: SUPPLIER_ID, name: "Makro" }]}
        ingredients={[
          { id: INGREDIENT_ID, name: "Flour", unit: "kg" },
          { id: INGREDIENT_B, name: "Milk", unit: "L" },
        ]}
        isLoading={false}
        isSaving={isSaving}
        error={null}
        onClose={() => undefined}
        onSaveDraft={async () => true}
        onReceiveGoods={async () => true}
      />,
    );
  }

  function lineDraft(
    ingredientId: string,
    taxCategory = "food",
  ) {
    return {
      ingredient_id: ingredientId,
      quantity: 1,
      unit_cost: 2,
      discount: 0,
      tax_category: taxCategory,
      tax_regime: "reduced_vat",
      price_mode: "exclusive" as const,
    };
  }

  function discountCell(index: number): HTMLElement {
    const input = screen.getAllByRole("textbox", { name: "Discount" })[index];
    const cell = input?.closest("td");
    if (!cell) {
      throw new Error("discount cell missing");
    }
    return cell;
  }

  it("toggles tax cells on that line only", () => {
    renderLines([lineDraft(INGREDIENT_ID), lineDraft(INGREDIENT_B)]);

    const toggles = screen.getAllByRole("button", { name: "Tax and discount" });
    expect(toggles[0]).toHaveAttribute("aria-expanded", "false");
    expect(discountCell(0)).toHaveClass("hidden");
    expect(discountCell(1)).toHaveClass("hidden");

    fireEvent.click(toggles[0]!);

    expect(toggles[0]).toHaveAttribute("aria-expanded", "true");
    expect(discountCell(0)).not.toHaveClass("hidden");
    expect(discountCell(1)).toHaveClass("hidden");
  });

  it("expands a line with a tax category error after a failed submit", () => {
    renderLines([lineDraft(INGREDIENT_ID, "")]);

    const cell = taxSelect("food").closest("td");
    expect(cell).toHaveClass("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    expect(cell).not.toHaveClass("hidden");
    expect(screen.getByText("Tax category is required")).toBeInTheDocument();
  });

  it("keeps the expanded state on the right line when an earlier line is removed", () => {
    renderLines([
      lineDraft(INGREDIENT_ID),
      lineDraft(INGREDIENT_B),
      lineDraft(INGREDIENT_ID),
    ]);

    fireEvent.click(screen.getAllByRole("button", { name: "Tax and discount" })[2]!);
    expect(discountCell(2)).not.toHaveClass("hidden");

    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);

    expect(screen.getAllByRole("button", { name: "Tax and discount" })).toHaveLength(2);
    expect(discountCell(0)).toHaveClass("hidden");
    expect(discountCell(1)).not.toHaveClass("hidden");
    expect(
      screen.getAllByRole("button", { name: "Tax and discount" })[1],
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("adds a line from Add another line", () => {
    renderLines([lineDraft(INGREDIENT_ID)]);

    expect(screen.getAllByRole("button", { name: "Tax and discount" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Add another line" }));

    expect(screen.getAllByRole("button", { name: "Tax and discount" })).toHaveLength(2);
  });

  it("disables Add another line while saving", () => {
    renderLines([lineDraft(INGREDIENT_ID)], true);

    expect(screen.getByRole("button", { name: "Add another line" })).toBeDisabled();
  });

  it("toggles More details", () => {
    renderLines([lineDraft(INGREDIENT_ID)]);

    const more = screen.getByRole("button", { name: "More details" });
    expect(more).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(more);

    expect(screen.getByRole("button", { name: "Fewer details" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

function ingredientSelect(): HTMLSelectElement {
  const match = screen.getAllByRole("combobox").find((element) =>
    Array.from((element as HTMLSelectElement).options).some(
      (option) => option.value === INGREDIENT_ID,
    ),
  );
  if (!match) {
    throw new Error("ingredient select missing");
  }
  return match as HTMLSelectElement;
}

function taxSelect(optionValue: string): HTMLSelectElement {
  const match = screen.getAllByRole("combobox").find((element) =>
    Array.from((element as HTMLSelectElement).options).some(
      (option) => option.value === optionValue,
    ),
  );
  if (!match) {
    throw new Error(`select with ${optionValue} missing`);
  }
  return match as HTMLSelectElement;
}

describe("PurchaseDocumentModal source receipt banner", () => {
  afterEach(() => {
    cleanup();
    getLastPurchaseLines.mockReset();
    vi.mocked(purchaseReceiptService.signStoragePaths).mockReset();
  });

  function sourceReceipt(): PurchaseReceiptCard {
    return {
      id: "receipt-1",
      purchaseId: null,
      supplierId: null,
      supplierName: null,
      receiptDate: "2026-10-05",
      receiptTotal: null,
      note: null,
      pageCount: 1,
      pagePaths: ["receipt/page.jpg"],
      thumbnailUrl: null,
      files: [],
    };
  }

  function renderWithReceipt(
    receipt: PurchaseReceiptCard,
    purchase: PurchaseWithRelations | null = null,
  ) {
    getLastPurchaseLines.mockResolvedValue({ data: [], error: null });
    render(
      <PurchaseDocumentModal
        isOpen
        purchase={purchase}
        initialValues={{
          supplier_id: "",
          invoice_number: "",
          purchased_at: "2026-10-05",
          notes: "",
          supplier_country: "NL",
          tax_country: "NL",
          lines: [],
        }}
        suppliers={[{ id: SUPPLIER_ID, name: "Makro" }]}
        ingredients={[{ id: INGREDIENT_ID, name: "Flour", unit: "kg" }]}
        isLoading={false}
        isSaving={false}
        error={null}
        onClose={() => undefined}
        onSaveDraft={async () => true}
        onReceiveGoods={async () => true}
        sourceReceipt={receipt}
      />,
    );
  }

  it("describes the receipt and links the signed photo", async () => {
    vi.mocked(purchaseReceiptService.signStoragePaths).mockResolvedValue({
      data: ["https://signed.example/photo"],
      error: null,
    });
    renderWithReceipt({
      ...sourceReceipt(),
      supplierName: "Sligro",
      receiptTotal: 37.13,
    });

    expect(
      screen.getByText(
        `From receipt · Sligro · ${formatReceiptDisplayDate("2026-10-05")} · ${formatMoney(37.13)}`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("The receipt is attached when you save.")).toBeInTheDocument();
    const link = await screen.findByRole("link", { name: "Open photo" });
    expect(link).toHaveAttribute("href", "https://signed.example/photo");
    expect(link).toHaveAttribute("target", "_blank");
    expect(purchaseReceiptService.signStoragePaths).toHaveBeenCalledWith(["receipt/page.jpg"]);
  });

  it("falls back to No supplier and no total and hides Open photo when signing fails", async () => {
    vi.mocked(purchaseReceiptService.signStoragePaths).mockResolvedValue({
      data: null,
      error: "Could not open the photo.",
    });
    renderWithReceipt(sourceReceipt());

    expect(
      screen.getByText(
        `From receipt · No supplier · ${formatReceiptDisplayDate("2026-10-05")} · no total`,
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(purchaseReceiptService.signStoragePaths).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("link", { name: "Open photo" })).not.toBeInTheDocument();
  });

  it("does not show the banner on a saved purchase", () => {
    vi.mocked(purchaseReceiptService.signStoragePaths).mockResolvedValue({
      data: [null],
      error: null,
    });
    vi.mocked(purchaseReceiptService.listForPurchase).mockResolvedValue({
      data: [],
      error: null,
    });
    renderWithReceipt(sourceReceipt(), draftPurchase());

    expect(screen.queryByText(/From receipt/)).not.toBeInTheDocument();
  });
});

describe("PurchaseDocumentModal fill lines from receipt", () => {
  afterEach(() => {
    cleanup();
    getLastPurchaseLines.mockReset();
    requestRecognition.mockReset();
    vi.mocked(purchaseReceiptService.signStoragePaths).mockReset();
    vi.mocked(purchaseReceiptService.matchReceiptLines).mockReset();
    vi.mocked(purchaseReceiptService.rememberReceiptLineMapping).mockReset();
  });

  function receiptCard(): PurchaseReceiptCard {
    return {
      id: "receipt-1",
      purchaseId: null,
      supplierId: SUPPLIER_ID,
      supplierName: "Makro",
      receiptDate: "2026-10-05",
      receiptTotal: 8.25,
      note: null,
      pageCount: 1,
      pagePaths: ["receipt/page.jpg"],
      thumbnailUrl: null,
      files: [],
    };
  }

  function recognitionResult() {
    return {
      status: "ok" as const,
      cached: false,
      recognitionId: "recognition-1",
      result: {
        schemaVersion: 1 as const,
        readable: true,
        storeName: "Makro",
        receiptDate: "2026-10-05",
        currency: "EUR",
        total: 8.25,
        lines: [
          {
            text: "MEEL 5KG",
            quantity: 2,
            unitPrice: 2.5,
            lineTotal: 5,
            vatRate: 9,
            kind: "item" as const,
          },
          {
            text: "MELK",
            quantity: 2,
            unitPrice: 1.5,
            lineTotal: 3,
            vatRate: null,
            kind: "item" as const,
          },
          {
            text: "TAS",
            quantity: null,
            unitPrice: null,
            lineTotal: 0.25,
            vatRate: 21,
            kind: "bag" as const,
          },
        ],
      },
    };
  }

  function blankLine() {
    return {
      ingredient_id: "",
      quantity: 1,
      unit_cost: 0,
      discount: 0,
      tax_category: "food",
      tax_regime: "reduced_vat",
      price_mode: "inclusive" as const,
    };
  }

  function renderFromReceipt(options?: {
    supplierId?: string;
    lines?: Array<ReturnType<typeof blankLine>>;
    onSaveDraft?: (values: PurchaseFormValues) => Promise<boolean>;
  }) {
    getLastPurchaseLines.mockResolvedValue({ data: [], error: null });
    vi.mocked(purchaseReceiptService.signStoragePaths).mockResolvedValue({
      data: [null],
      error: null,
    });
    vi.mocked(purchaseReceiptService.matchReceiptLines).mockResolvedValue({
      data: [
        { lineIndex: 1, action: "ingredient", ingredientId: INGREDIENT_ID, unitsPerItem: 0.5 },
        { lineIndex: 2, action: null, ingredientId: null, unitsPerItem: null },
        { lineIndex: 3, action: null, ingredientId: null, unitsPerItem: null },
      ],
      error: null,
    });
    vi.mocked(purchaseReceiptService.rememberReceiptLineMapping).mockResolvedValue({
      data: "mapping-1",
      error: null,
    });
    requestRecognition.mockResolvedValue(recognitionResult());
    const onSaveDraft = vi.fn(options?.onSaveDraft ?? (async () => true));
    render(
      <PurchaseDocumentModal
        isOpen
        purchase={null}
        initialValues={{
          supplier_id: options?.supplierId ?? SUPPLIER_ID,
          invoice_number: "",
          purchased_at: "2026-10-05",
          notes: "",
          supplier_country: "NL",
          tax_country: "NL",
          lines: options?.lines ?? [blankLine()],
        }}
        suppliers={[{ id: SUPPLIER_ID, name: "Makro" }]}
        ingredients={[
          { id: INGREDIENT_ID, name: "Flour", unit: "kg" },
          { id: INGREDIENT_B, name: "Milk", unit: "L" },
        ]}
        isLoading={false}
        isSaving={false}
        error={null}
        onClose={() => undefined}
        onSaveDraft={onSaveDraft}
        onReceiveGoods={async () => true}
        sourceReceipt={receiptCard()}
      />,
    );
    return onSaveDraft;
  }

  function ingredientSelects(): HTMLSelectElement[] {
    return screen
      .getAllByRole("combobox")
      .filter((element): element is HTMLSelectElement =>
        Array.from((element as HTMLSelectElement).options).some(
          (option) => option.value === INGREDIENT_ID,
        ),
      );
  }

  function inputValues(elements: HTMLElement[]): string[] {
    return elements.map((element) => (element as HTMLInputElement).value);
  }

  async function fill() {
    fireEvent.click(screen.getByRole("button", { name: "Fill lines from receipt" }));
    await screen.findByText(/added €8\.00/);
  }

  it("replaces a blank line with the receipt lines", async () => {
    renderFromReceipt();

    await fill();

    expect(ingredientSelects().map((select) => select.value)).toEqual([INGREDIENT_ID, ""]);
    expect(inputValues(screen.getAllByPlaceholderText("0"))).toEqual(["1", "2"]);
    expect(inputValues(screen.getAllByRole("textbox", { name: "Line total" }))).toEqual([
      "5",
      "3",
    ]);
    expect(inputValues(screen.getAllByRole("textbox", { name: "Unit price" }))).toEqual([
      "5",
      "1.5",
    ]);
    expect(purchaseReceiptService.matchReceiptLines).toHaveBeenCalledWith(SUPPLIER_ID, [
      "MEEL 5KG",
      "MELK",
      "TAS",
    ]);
  });

  it("appends after a line the user already filled", async () => {
    renderFromReceipt({ lines: [{ ...blankLine(), ingredient_id: INGREDIENT_B }] });

    await fill();

    expect(ingredientSelects().map((select) => select.value)).toEqual([
      INGREDIENT_B,
      INGREDIENT_ID,
      "",
    ]);
  });

  it("shows the receipt hint and Check VAT, and Skip removes the line", async () => {
    renderFromReceipt();

    await fill();

    expect(screen.getByText("Receipt: MEEL 5KG · 2 × · €5.00")).toBeInTheDocument();
    expect(screen.getByText("Receipt: MELK · 2 × · €3.00")).toBeInTheDocument();
    expect(screen.getAllByText("Check VAT")).toHaveLength(1);

    const skipButtons = screen.getAllByRole("button", { name: "Skip" });
    expect(skipButtons).toHaveLength(2);
    fireEvent.click(skipButtons[1] as HTMLElement);

    expect(screen.queryByText("Receipt: MELK · 2 × · €3.00")).not.toBeInTheDocument();
    expect(ingredientSelects()).toHaveLength(1);
  });

  it("keeps the receipt price when a last purchase price arrives", async () => {
    renderFromReceipt();
    getLastPurchaseLines.mockResolvedValue(lastLineResponse());

    await fill();

    await waitFor(() => {
      expect(getLastPurchaseLines).toHaveBeenCalledWith([INGREDIENT_ID], SUPPLIER_ID);
    });
    await screen.findByRole("button", { name: /Use$/ });
    expect(screen.getAllByRole("textbox", { name: "Unit price" })[0]).toHaveValue("5");
    expect(screen.getAllByRole("textbox", { name: "Line total" })[0]).toHaveValue("5");
  });

  it("keeps the receipt amount when the ingredient is switched", async () => {
    renderFromReceipt();

    await fill();
    fireEvent.change(ingredientSelects()[0] as HTMLElement, {
      target: { value: INGREDIENT_B },
    });

    expect(ingredientSelects()[0]).toHaveValue(INGREDIENT_B);
    expect(screen.getAllByRole("textbox", { name: "Line total" })[0]).toHaveValue("5");
    expect(screen.getAllByRole("textbox", { name: "Unit price" })[0]).toHaveValue("5");
  });

  it("saves values without receipt_source and then remembers the lines", async () => {
    let resolveSave: (value: boolean) => void = () => undefined;
    const onSaveDraft = renderFromReceipt({
      onSaveDraft: () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve;
        }),
    });

    await fill();
    fireEvent.click(screen.getAllByRole("button", { name: "Skip" })[1] as HTMLElement);
    fireEvent.change(screen.getAllByPlaceholderText("0")[0] as HTMLElement, {
      target: { value: "1.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => {
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });
    const saved = onSaveDraft.mock.calls[0]?.[0];
    expect(saved?.lines).toHaveLength(1);
    expect(saved?.lines[0]).not.toHaveProperty("receipt_source");
    expect(purchaseReceiptService.rememberReceiptLineMapping).not.toHaveBeenCalled();

    resolveSave(true);

    await waitFor(() => {
      expect(purchaseReceiptService.rememberReceiptLineMapping).toHaveBeenCalledTimes(2);
    });
    expect(vi.mocked(purchaseReceiptService.rememberReceiptLineMapping).mock.calls).toEqual([
      [
        {
          supplierId: SUPPLIER_ID,
          receiptText: "MELK",
          action: "skip",
          ingredientId: null,
          unitsPerItem: null,
        },
      ],
      [
        {
          supplierId: SUPPLIER_ID,
          receiptText: "MEEL 5KG",
          action: "ingredient",
          ingredientId: INGREDIENT_ID,
          unitsPerItem: 0.75,
        },
      ],
    ]);
  });

  it("remembers a newly chosen ingredient but not an unchanged mapping", async () => {
    const onSaveDraft = renderFromReceipt();

    await fill();
    fireEvent.change(ingredientSelects()[1] as HTMLElement, {
      target: { value: INGREDIENT_B },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => {
      expect(purchaseReceiptService.rememberReceiptLineMapping).toHaveBeenCalledTimes(1);
    });
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    expect(purchaseReceiptService.rememberReceiptLineMapping).toHaveBeenCalledWith({
      supplierId: SUPPLIER_ID,
      receiptText: "MELK",
      action: "ingredient",
      ingredientId: INGREDIENT_B,
      unitsPerItem: 1,
    });
  });

  it("remembers nothing when the save fails", async () => {
    const onSaveDraft = renderFromReceipt({ onSaveDraft: async () => false });

    await fill();
    fireEvent.change(ingredientSelects()[1] as HTMLElement, {
      target: { value: INGREDIENT_B },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => {
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(purchaseReceiptService.rememberReceiptLineMapping).not.toHaveBeenCalled();
  });

  it("remembers nothing without a supplier", async () => {
    const onSaveDraft = renderFromReceipt({ supplierId: "" });

    await fill();
    fireEvent.change(ingredientSelects()[1] as HTMLElement, {
      target: { value: INGREDIENT_B },
    });
    fireEvent.change(ingredientSelects()[0] as HTMLElement, {
      target: { value: INGREDIENT_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));

    await waitFor(() => {
      expect(onSaveDraft).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(purchaseReceiptService.matchReceiptLines).not.toHaveBeenCalled();
    expect(purchaseReceiptService.rememberReceiptLineMapping).not.toHaveBeenCalled();
  });
});

describe("draftToValues", () => {
  it("never passes receipt_source on", () => {
    const values = draftToValues({
      supplier_id: SUPPLIER_ID,
      invoice_number: "",
      purchased_at: "2026-10-05",
      notes: "",
      supplier_country: "NL",
      tax_country: "NL",
      lines: [
        {
          ingredient_id: INGREDIENT_ID,
          quantity: "1",
          unit_cost: "5",
          line_total: "5",
          last_edited_field: "line_total",
          discount: "",
          tax_category: "food",
          tax_regime: "reduced_vat",
          price_mode: "inclusive",
          receipt_source: {
            text: "MEEL",
            quantity: 2,
            lineTotal: 5,
            mapped: null,
            vatUnclear: false,
          },
        },
      ],
    });

    expect(values.lines[0]).not.toHaveProperty("receipt_source");
  });
});
