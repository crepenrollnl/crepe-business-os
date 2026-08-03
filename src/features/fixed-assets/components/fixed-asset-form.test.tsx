import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { FixedAssetForm } from "./fixed-asset-form";

function renderForm(overrides?: {
  error?: string | null;
  onSubmit?: (input: unknown) => Promise<boolean>;
}) {
  const onSubmit = overrides?.onSubmit ?? vi.fn().mockResolvedValue(true);

  render(
    <FixedAssetForm
      isSaving={false}
      error={overrides?.error ?? null}
      onSubmit={onSubmit as never}
    />,
  );

  return { onSubmit };
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Name"), {
    target: { value: "Food truck" },
  });
  fireEvent.change(screen.getByLabelText("Purchase Date"), {
    target: { value: "2026-01-15" },
  });
  fireEvent.change(screen.getByLabelText("Cost"), {
    target: { value: "24000" },
  });
  fireEvent.change(screen.getByLabelText("Useful Life (Months)"), {
    target: { value: "60" },
  });
}

describe("FixedAssetForm", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the submit button disabled and reveals field errors on blur when required fields are empty", async () => {
    const { onSubmit } = renderForm();

    expect(
      screen.getByRole("button", { name: /register asset/i }),
    ).toBeDisabled();

    fireEvent.blur(screen.getByLabelText("Name"));
    fireEvent.blur(screen.getByLabelText("Purchase Date"));
    fireEvent.blur(screen.getByLabelText("Cost"));
    fireEvent.blur(screen.getByLabelText("Useful Life (Months)"));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(screen.getByText("Purchase date is required")).toBeInTheDocument();
    expect(screen.getByText("Enter a cost greater than 0")).toBeInTheDocument();
    expect(
      screen.getByText("Enter a whole number of months greater than 0"),
    ).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("rejects a non-integer useful life", async () => {
    renderForm();

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Useful Life (Months)"), {
      target: { value: "24.5" },
    });
    fireEvent.blur(screen.getByLabelText("Useful Life (Months)"));

    expect(
      await screen.findByText("Enter a whole number of months greater than 0"),
    ).toBeInTheDocument();
  });

  it("submits the entered values once fields are valid", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderForm({ onSubmit });

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /register asset/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        name: "Food truck",
        purchaseDate: "2026-01-15",
        cost: 24000,
        usefulLifeMonths: 60,
      });
    });
  });

  it("resets the form after a successful submit", async () => {
    renderForm({ onSubmit: vi.fn().mockResolvedValue(true) });

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /register asset/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue("");
    });
    expect(screen.getByLabelText("Cost")).toHaveValue("");
  });

  it("keeps the entered values when the submit fails", async () => {
    renderForm({ onSubmit: vi.fn().mockResolvedValue(false) });

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /register asset/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveValue("Food truck");
    });
  });

  it("shows the formError banner from the parent", () => {
    renderForm({ error: "Useful life (months) must be greater than 0." });

    expect(
      screen.getByText("Useful life (months) must be greater than 0."),
    ).toBeInTheDocument();
  });
});
