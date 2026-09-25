import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type {
  FirstLevelRawIngredient,
  ProductionSessionLineView,
} from "../types/production-session";
import {
  clearMatchMediaStub,
  stubMatchMedia,
} from "../hooks/stub-match-media";
import { ADJUST_INGREDIENT_SCALE_SUMMARY } from "./production-session-line-card";
import {
  HELPER_HELP,
  ProductionSessionLinesSection,
  RAW_MATERIAL_SCALE_HELP,
  SESSION_LINES_CARDS_TEST_ID,
  SESSION_LINES_TABLE_TEST_ID,
} from "./production-session-lines-section";

const LINE_ID = "line-1";
const RECIPE_ID = "recipe-1";

function line(
  overrides?: Partial<ProductionSessionLineView>,
): ProductionSessionLineView {
  return {
    id: LINE_ID,
    production_session_id: "session-1",
    production_plan_product_id: "plan-product-1",
    recipe_id: RECIPE_ID,
    product_name: "Smoked Salmon",
    planned_quantity: 2,
    actual_produced_quantity: 1.8,
    raw_material_scale: null,
    yield_unit: "kg",
    sort_order: 1,
    difference: -0.2,
    ...overrides,
  };
}

const idleHandlers = {
  canEdit: true,
  drafts: {
    [LINE_ID]: { raw: "1.8", value: 1.8, error: null },
  },
  rawMaterialScaleDrafts: {
    [LINE_ID]: { raw: "", value: null, error: null },
  },
  helperDrafts: {} as Record<
    string,
    { raw: string; selectedIngredientId: string | null; error: string | null }
  >,
  onProducedChange: vi.fn(),
  onRawMaterialScaleChange: vi.fn(),
  onHelperQuantityChange: vi.fn(),
  onHelperIngredientChange: vi.fn(),
};

function renderLines(
  firstLevel: readonly FirstLevelRawIngredient[],
  extra?: Partial<typeof idleHandlers>,
) {
  const firstLevelRawByRecipeId = new Map<
    string,
    readonly FirstLevelRawIngredient[]
  >([[RECIPE_ID, firstLevel]]);

  return render(
    <ProductionSessionLinesSection
      lines={[line()]}
      firstLevelRawByRecipeId={firstLevelRawByRecipeId}
      {...idleHandlers}
      {...extra}
    />,
  );
}

function table() {
  return within(screen.getByTestId(SESSION_LINES_TABLE_TEST_ID));
}

function cards() {
  return within(screen.getByTestId(SESSION_LINES_CARDS_TEST_ID));
}

describe("ProductionSessionLinesSection raw-scale helper", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    clearMatchMediaStub();
  });

  it("hides the helper when the recipe has no first-level raw ingredients", () => {
    renderLines([]);

    expect(
      table().queryByText("Actual ingredient used"),
    ).not.toBeInTheDocument();
    expect(
      table().getByLabelText("Recipe batches used for Smoked Salmon"),
    ).toBeVisible();
    expect(table().getByText("Recipe Batches Used")).toBeVisible();
  });

  it("labels a single raw ingredient without a picker", () => {
    renderLines([
      {
        ingredient_id: "salmon",
        name: "Salmon",
        quantity: 3,
        unit: "kg",
      },
    ]);

    expect(table().getByText("Salmon (recipe: 3 kg)")).toBeVisible();
    expect(
      table().queryByLabelText("Reference ingredient for Smoked Salmon"),
    ).not.toBeInTheDocument();
    expect(
      table().getByLabelText("Actual Salmon used for Smoked Salmon"),
    ).toBeVisible();
  });

  it("shows a picker when the recipe has two or more raw ingredients", () => {
    renderLines([
      {
        ingredient_id: "salmon",
        name: "Salmon",
        quantity: 2.1,
        unit: "kg",
      },
      {
        ingredient_id: "salt",
        name: "Salt",
        quantity: 0.2,
        unit: "kg",
      },
    ]);

    expect(
      table().getByLabelText("Reference ingredient for Smoked Salmon"),
    ).toBeVisible();
    expect(table().getByText("Salmon — recipe: 2.1 kg")).toBeInTheDocument();
    expect(table().getByText("Salt — recipe: 0.2 kg")).toBeInTheDocument();
  });

  it("shows column help as visible text instead of title tooltips", () => {
    renderLines([
      {
        ingredient_id: "salmon",
        name: "Salmon",
        quantity: 3,
        unit: "kg",
      },
    ]);

    expect(table().getByText(HELPER_HELP)).toBeVisible();
    expect(table().getByText(RAW_MATERIAL_SCALE_HELP)).toBeVisible();
    expect(
      table().getByText("Actual ingredient used").closest("th"),
    ).not.toHaveAttribute("title");
    expect(
      table().getByText("Recipe Batches Used").closest("th"),
    ).not.toHaveAttribute("title");
  });

  it("still shows Recipe Batches Used help when the helper column is hidden", () => {
    renderLines([]);

    expect(table().queryByText(HELPER_HELP)).not.toBeInTheDocument();
    expect(table().getByText(RAW_MATERIAL_SCALE_HELP)).toBeVisible();
  });

  it("uses 16px kitchen-safe number inputs", () => {
    renderLines([
      {
        ingredient_id: "salmon",
        name: "Salmon",
        quantity: 3,
        unit: "kg",
      },
    ]);

    const produced = table().getByLabelText(
      "Actual produced quantity for Smoked Salmon",
    );
    const helper = table().getByLabelText("Actual Salmon used for Smoked Salmon");
    const scale = table().getByLabelText("Recipe batches used for Smoked Salmon");

    for (const input of [produced, helper, scale]) {
      expect(input).toHaveClass("h-11", "text-base");
    }
  });

  it("keeps Recipe Batches Used editable next to the helper", () => {
    renderLines([
      {
        ingredient_id: "salmon",
        name: "Salmon",
        quantity: 3,
        unit: "kg",
      },
    ]);

    const helper = table().getByLabelText("Actual Salmon used for Smoked Salmon");
    const scale = table().getByLabelText("Recipe batches used for Smoked Salmon");

    fireEvent.change(helper, { target: { value: "6" } });
    fireEvent.change(scale, { target: { value: "1.5" } });

    expect(idleHandlers.onHelperQuantityChange).toHaveBeenCalledWith(
      LINE_ID,
      RECIPE_ID,
      "6",
    );
    expect(idleHandlers.onRawMaterialScaleChange).toHaveBeenCalledWith(
      LINE_ID,
      "1.5",
    );
  });
});

describe("ProductionSessionLinesSection tablet cards", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    clearMatchMediaStub();
  });

  it("mounts only the desktop table by default", () => {
    renderLines([]);

    expect(screen.getByTestId(SESSION_LINES_TABLE_TEST_ID)).toBeInTheDocument();
    expect(
      screen.queryByTestId(SESSION_LINES_CARDS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  it("mounts only the tablet cards below lg", async () => {
    stubMatchMedia(false);
    renderLines([]);

    await waitFor(() => {
      expect(screen.getByTestId(SESSION_LINES_CARDS_TEST_ID)).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId(SESSION_LINES_TABLE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  it("makes produced quantity the primary field and parks scale fields in a disclosure", async () => {
    stubMatchMedia(false);
    renderLines([
      {
        ingredient_id: "salmon",
        name: "Salmon",
        quantity: 3,
        unit: "kg",
      },
    ]);

    await waitFor(() => {
      expect(screen.getByTestId(SESSION_LINES_CARDS_TEST_ID)).toBeInTheDocument();
    });
    const card = cards().getByRole("article");
    expect(within(card).getByRole("heading", { name: "Smoked Salmon" })).toBeVisible();
    expect(within(card).getByText("2 kg")).toBeVisible();
    expect(
      within(card).getByLabelText("Actual produced quantity for Smoked Salmon"),
    ).toHaveClass("h-11", "w-full", "text-base");
    expect(
      within(card).getByText(ADJUST_INGREDIENT_SCALE_SUMMARY),
    ).toBeVisible();

    const disclosure = within(card).getByText(ADJUST_INGREDIENT_SCALE_SUMMARY)
      .closest("details");
    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveAttribute("open");

    fireEvent.click(within(card).getByText(ADJUST_INGREDIENT_SCALE_SUMMARY));

    expect(within(card).getByText(HELPER_HELP)).toBeVisible();
    expect(within(card).getByText(RAW_MATERIAL_SCALE_HELP)).toBeVisible();
    expect(
      within(card).getByLabelText("Actual Salmon used for Smoked Salmon"),
    ).toBeVisible();
    expect(
      within(card).getByLabelText("Recipe batches used for Smoked Salmon"),
    ).toBeVisible();
  });

  it("lets staff edit scale fields from the card disclosure", async () => {
    stubMatchMedia(false);
    renderLines([
      {
        ingredient_id: "salmon",
        name: "Salmon",
        quantity: 3,
        unit: "kg",
      },
    ]);

    await waitFor(() => {
      expect(screen.getByTestId(SESSION_LINES_CARDS_TEST_ID)).toBeInTheDocument();
    });
    const card = cards().getByRole("article");
    fireEvent.click(within(card).getByText(ADJUST_INGREDIENT_SCALE_SUMMARY));
    fireEvent.change(
      within(card).getByLabelText("Actual Salmon used for Smoked Salmon"),
      { target: { value: "6" } },
    );
    fireEvent.change(
      within(card).getByLabelText("Recipe batches used for Smoked Salmon"),
      { target: { value: "1.5" } },
    );

    expect(idleHandlers.onHelperQuantityChange).toHaveBeenCalledWith(
      LINE_ID,
      RECIPE_ID,
      "6",
    );
    expect(idleHandlers.onRawMaterialScaleChange).toHaveBeenCalledWith(
      LINE_ID,
      "1.5",
    );
  });

  it("matches the tablet card class contract", async () => {
    stubMatchMedia(false);
    renderLines([]);

    await waitFor(() => {
      expect(screen.getByTestId(SESSION_LINES_CARDS_TEST_ID)).toBeInTheDocument();
    });
    expect(screen.getByTestId(SESSION_LINES_CARDS_TEST_ID).className)
      .toMatchInlineSnapshot(`"space-y-3 bg-zinc-50 p-3"`);
    expect(cards().getByRole("article").className).toMatchInlineSnapshot(
      `"rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"`,
    );
  });
});
