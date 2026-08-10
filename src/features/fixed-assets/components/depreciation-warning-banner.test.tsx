import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { DepreciationWarningBanner } from "./depreciation-warning-banner";

describe("DepreciationWarningBanner", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows the message and dismisses on click", () => {
    const onDismiss = vi.fn();

    render(
      <DepreciationWarningBanner
        message="Depreciation Expense account (6200) is missing or inactive."
        onDismiss={onDismiss}
      />,
    );

    expect(
      screen.getByText(
        "Depreciation catch-up did not run: Depreciation Expense account (6200) is missing or inactive.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
