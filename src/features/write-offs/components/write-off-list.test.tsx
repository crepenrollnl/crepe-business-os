import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { WriteOffList } from "./write-off-list";
import type { WriteOffRecord } from "../types/write-off";

const row: WriteOffRecord = {
  id: "wo-1",
  item_type: "ingredient",
  ingredient_id: "ing-1",
  product_id: null,
  quantity: 2,
  unit_cost: 5,
  total_value: 10,
  reason: "spoilage",
  note: null,
  created_by: null,
  created_at: "2026-09-05T10:00:00.000Z",
  item_name: "Chicken",
};

describe("WriteOffList", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders date, item, quantity, reason, and amount", () => {
    render(
      <WriteOffList
        writeOffs={[row]}
        periodFrom="2026-09-01"
        periodTo="2026-09-30"
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Chicken")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Spoiled / Expired")).toBeInTheDocument();
    expect(screen.getByText("€10.00")).toBeInTheDocument();
  });

  it("hides rows outside the selected period", () => {
    render(
      <WriteOffList
        writeOffs={[row]}
        periodFrom="2026-08-01"
        periodTo="2026-08-31"
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("No write-offs yet")).toBeInTheDocument();
    expect(screen.queryByText("Chicken")).not.toBeInTheDocument();
  });
});
