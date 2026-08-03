import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ExpenseForm } from "./expense-form";
import type { ExpenseAccountOption } from "../types/expense";

const ACCOUNTS: ExpenseAccountOption[] = [
  { id: "account-6010", code: "6010", name: "Ingredients (off-cycle)" },
  { id: "account-6060", code: "6060", name: "Fuel & Transport" },
];

function renderForm(overrides?: {
  error?: string | null;
  lastPostingNumber?: string | null;
  onSubmit?: (input: unknown) => Promise<boolean>;
  onDismissSuccess?: () => void;
}) {
  const onSubmit = overrides?.onSubmit ?? vi.fn().mockResolvedValue(true);
  const onDismissSuccess = overrides?.onDismissSuccess ?? vi.fn();

  render(
    <ExpenseForm
      accounts={ACCOUNTS}
      isSaving={false}
      error={overrides?.error ?? null}
      lastPostingNumber={overrides?.lastPostingNumber ?? null}
      onSubmit={onSubmit as never}
      onDismissSuccess={onDismissSuccess}
    />,
  );

  return { onSubmit, onDismissSuccess };
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Category"), {
    target: { value: "account-6060" },
  });
  fireEvent.change(screen.getByLabelText("Gross Amount"), {
    target: { value: "121" },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: { value: "Diesel fill-up" },
  });
}

describe("ExpenseForm", () => {
  afterEach(() => {
    cleanup();
  });

  it("keeps the submit button disabled and reveals field errors on blur when required fields are empty", async () => {
    const { onSubmit } = renderForm();

    expect(screen.getByRole("button", { name: /record expense/i })).toBeDisabled();

    fireEvent.blur(screen.getByLabelText("Category"));
    fireEvent.blur(screen.getByLabelText("Gross Amount"));
    fireEvent.blur(screen.getByLabelText("Description"));

    expect(await screen.findByText("Category is required")).toBeInTheDocument();
    expect(screen.getByText("Enter an amount greater than 0")).toBeInTheDocument();
    expect(screen.getByText("Description is required")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("shows a live Net/VAT/Gross breakdown for the default 21% rate", () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("Gross Amount"), {
      target: { value: "121" },
    });

    expect(screen.getByText(/Net €100\.00/)).toBeInTheDocument();
    expect(screen.getByText(/VAT €21\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Gross €121\.00/)).toBeInTheDocument();
  });

  it("submits the derived input (gross + selected VAT rate) once fields are valid", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderForm({ onSubmit });

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          accountId: "account-6060",
          grossAmount: 121,
          vatRate: 0.21,
          description: "Diesel fill-up",
          supplier: null,
        }),
      );
    });
  });

  it("resets the form after a successful submit", async () => {
    renderForm({ onSubmit: vi.fn().mockResolvedValue(true) });

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Description")).toHaveValue("");
    });
    expect(screen.getByLabelText("Gross Amount")).toHaveValue("");
  });

  it("keeps the entered values when the submit fails", async () => {
    renderForm({ onSubmit: vi.fn().mockResolvedValue(false) });

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

    await waitFor(() => {
      expect(screen.getByLabelText("Description")).toHaveValue("Diesel fill-up");
    });
  });

  it("shows the formError banner from the parent", () => {
    renderForm({ error: "No open fiscal period covers this date." });

    expect(
      screen.getByText("No open fiscal period covers this date."),
    ).toBeInTheDocument();
  });

  it("shows a success banner with the posting number and dismisses it", () => {
    const onDismissSuccess = vi.fn();
    renderForm({ lastPostingNumber: "JE-2026-000001", onDismissSuccess });

    expect(screen.getByText("JE-2026-000001")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));

    expect(onDismissSuccess).toHaveBeenCalledTimes(1);
  });
});
