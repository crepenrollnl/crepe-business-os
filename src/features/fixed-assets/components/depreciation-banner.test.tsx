import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { DepreciationBanner } from "./depreciation-banner";
import type { RunDepreciationResult } from "../types/fixed-asset";

describe("DepreciationBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the entry count, period list, and total, and dismisses on click", () => {
    const onDismiss = vi.fn();
    const result: RunDepreciationResult = {
      entriesCreated: 2,
      totalAmount: 800,
      details: [
        {
          fixedAssetId: "asset-1",
          period: "2026-07-01",
          amount: 400,
          postingNumber: "JE-2026-000010",
        },
        {
          fixedAssetId: "asset-1",
          period: "2026-08-01",
          amount: 400,
          postingNumber: "JE-2026-000011",
        },
      ],
      skipped: [],
    };

    render(<DepreciationBanner result={result} onDismiss={onDismiss} />);

    expect(
      screen.getByText(/Depreciation posted for 2 periods: Jul 2026, Aug 2026, total €800\.00\./),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("uses the singular 'period' for exactly one entry", () => {
    const result: RunDepreciationResult = {
      entriesCreated: 1,
      totalAmount: 400,
      details: [
        {
          fixedAssetId: "asset-1",
          period: "2026-08-01",
          amount: 400,
          postingNumber: "JE-2026-000012",
        },
      ],
      skipped: [],
    };

    render(<DepreciationBanner result={result} onDismiss={vi.fn()} />);

    expect(
      screen.getByText(/Depreciation posted for 1 period: Aug 2026, total €400\.00\./),
    ).toBeInTheDocument();
  });
});
