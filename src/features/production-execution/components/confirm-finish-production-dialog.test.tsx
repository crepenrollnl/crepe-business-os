import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ConfirmFinishProductionDialog } from "./confirm-finish-production-dialog";

describe("ConfirmFinishProductionDialog", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when closed", () => {
    render(
      <ConfirmFinishProductionDialog
        isOpen={false}
        sessionNumber={42}
        finishing={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.queryByText("Finish production")).not.toBeInTheDocument();
  });

  it("warns that finishing locks in quantities and cannot be undone, and calls onConfirm on confirm", () => {
    const onConfirm = vi.fn().mockResolvedValue(true);

    render(
      <ConfirmFinishProductionDialog
        isOpen
        sessionNumber={42}
        finishing={false}
        error={null}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText(/#42/)).toBeInTheDocument();
    expect(
      screen.getByText(/locks in the produced quantities/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/cannot be undone from the production UI/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Finish Production" }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();

    render(
      <ConfirmFinishProductionDialog
        isOpen
        sessionNumber={42}
        finishing={false}
        error={null}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the error and disables Cancel/backdrop-close while finishing", () => {
    render(
      <ConfirmFinishProductionDialog
        isOpen
        sessionNumber={42}
        finishing
        error="Insufficient stock for Flour. Required 10, available 4."
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        "Insufficient stock for Flour. Required 10, available 4.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Finishing..." }),
    ).toBeDisabled();
  });
});
