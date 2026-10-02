import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { PurchaseWithRelations } from "../types/purchase";
import { PurchaseDocumentModal } from "./purchase-document-modal";

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
    });
    expect(unitPrice).toHaveValue("1.29");
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
