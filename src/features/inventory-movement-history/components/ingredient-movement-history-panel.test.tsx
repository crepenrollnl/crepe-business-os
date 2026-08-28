import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { InventoryMovementHistory } from "../types/inventory-movement-history";
import { MOVEMENT_HISTORY_STOCK_WARNING } from "../utils/format-movement-history";
import { IngredientMovementHistoryPanel } from "./ingredient-movement-history-panel";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const INGREDIENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PURCHASE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SESSION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const noop = () => undefined;

function movement(
  overrides?: Partial<InventoryMovementHistory>,
): InventoryMovementHistory {
  return {
    movement_id: "11111111-1111-4111-8111-111111111111",
    ingredient_id: INGREDIENT_ID,
    ingredient_name: "Flour",
    movement_type: "purchase_in",
    quantity: 10,
    unit: "kg",
    source_type: "purchase",
    source_id: PURCHASE_ID,
    occurred_at: "2026-07-25T16:00:00.000Z",
    ...overrides,
  };
}

describe("IngredientMovementHistoryPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("always shows the stock-gap warning", () => {
    render(
      <IngredientMovementHistoryPanel
        items={[]}
        loading={false}
        error={null}
        onRetry={noop}
      />,
    );

    expect(screen.getByRole("note")).toHaveTextContent(
      MOVEMENT_HISTORY_STOCK_WARNING,
    );
  });

  it("shows the empty copy when there are no movements", () => {
    render(
      <IngredientMovementHistoryPanel
        items={[]}
        loading={false}
        error={null}
        onRetry={noop}
      />,
    );

    expect(
      screen.getByText("No recorded movements for this ingredient yet."),
    ).toBeInTheDocument();
  });

  it("renders a received purchase as +qty with a purchase deep-link", () => {
    render(
      <IngredientMovementHistoryPanel
        items={[movement()]}
        loading={false}
        error={null}
        onRetry={noop}
      />,
    );

    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.getByText("+10 kg")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Purchase" })).toHaveAttribute(
      "href",
      `/purchases?open=${PURCHASE_ID}`,
    );
  });

  it("renders production usage as −qty with a session link", () => {
    render(
      <IngredientMovementHistoryPanel
        items={[
          movement({
            movement_id: "22222222-2222-4222-8222-222222222222",
            movement_type: "production_out",
            quantity: 29.75,
            source_type: "production_session",
            source_id: SESSION_ID,
          }),
        ]}
        loading={false}
        error={null}
        onRetry={noop}
      />,
    );

    expect(screen.getByText("Used in production")).toBeInTheDocument();
    expect(screen.getByText("−29.75 kg")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Production session" }),
    ).toHaveAttribute("href", `/production-execution/sessions/${SESSION_ID}`);
  });

  it("shows the error state with Retry", () => {
    const onRetry = vi.fn();

    render(
      <IngredientMovementHistoryPanel
        items={[]}
        loading={false}
        error="Failed to load inventory movement history"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(
      screen.getByText("Failed to load inventory movement history"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
