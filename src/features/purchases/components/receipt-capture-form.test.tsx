import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("../utils/prepare-receipt-image", () => ({
  prepareReceiptImage: vi.fn(async (file: File) => ({
    ok: true as const,
    blob: new Blob(["jpeg"], { type: "image/jpeg" }),
    originalFilename: file.name,
  })),
}));

import { ReceiptCaptureForm } from "./receipt-capture-form";
import { prepareReceiptImage } from "../utils/prepare-receipt-image";

const prepared = vi.mocked(prepareReceiptImage);

async function addPhoto(name = "market.jpg") {
  const input = screen.getByLabelText("Choose from gallery");
  await userEvent.upload(
    input,
    new File(["x"], name, { type: "image/jpeg" }),
  );
  await screen.findByAltText(name);
}

describe("ReceiptCaptureForm", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(() => "blob:preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    prepared.mockClear();
  });

  it("defaults the receipt date to the supplied Amsterdam date", () => {
    render(
      <ReceiptCaptureForm
        suppliers={[]}
        isSaving={false}
        today="2026-10-06"
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Receipt date")).toHaveValue("2026-10-06");
  });

  it("parses a comma decimal total", async () => {
    const onSave = vi.fn().mockResolvedValue({ error: null });
    render(
      <ReceiptCaptureForm suppliers={[]} isSaving={false} today="2026-10-05" onSave={onSave} />,
    );
    await addPhoto();
    await userEvent.type(screen.getByLabelText("Receipt total"), "37,13");
    await userEvent.click(screen.getByRole("button", { name: "Save receipt" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ receiptTotal: 37.13, receiptDate: "2026-10-05" }),
    );
  });

  it("requires a receipt date", async () => {
    const onSave = vi.fn();
    render(
      <ReceiptCaptureForm suppliers={[]} isSaving={false} today="2026-10-05" onSave={onSave} />,
    );
    await addPhoto();
    fireEvent.change(screen.getByLabelText("Receipt date"), {
      target: { value: "" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save receipt" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Receipt date is required.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("ignores a second tap while the first save is in flight", async () => {
    let resolveSave: (value: { error: null }) => void = () => undefined;
    const onSave = vi.fn(
      () =>
        new Promise<{ error: null }>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(
      <ReceiptCaptureForm suppliers={[]} isSaving={false} today="2026-10-05" onSave={onSave} />,
    );
    await addPhoto();
    const button = screen.getByRole("button", { name: "Save receipt" });
    await userEvent.click(button);
    await userEvent.click(button);
    expect(onSave).toHaveBeenCalledTimes(1);
    resolveSave({ error: null });
  });

  it("keeps the photo after a failed save and retries", async () => {
    const onSave = vi
      .fn()
      .mockResolvedValueOnce({ error: "Receipt photo was not uploaded. Try again." })
      .mockResolvedValueOnce({ error: null });
    render(
      <ReceiptCaptureForm suppliers={[]} isSaving={false} today="2026-10-05" onSave={onSave} />,
    );
    await addPhoto("market.jpg");
    await userEvent.click(screen.getByRole("button", { name: "Save receipt" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Receipt photo was not uploaded. Try again.",
    );
    expect(screen.getByAltText("market.jpg")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(screen.queryByAltText("market.jpg")).not.toBeInTheDocument();
  });

  it("adds a second page from the camera and renames the buttons", async () => {
    render(
      <ReceiptCaptureForm suppliers={[]} isSaving={false} today="2026-10-05" onSave={vi.fn()} />,
    );

    expect(screen.getByLabelText("Take photo")).toBeInTheDocument();
    expect(screen.getByLabelText("Choose from gallery")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add another page" })).not.toBeInTheDocument();

    await addPhoto("market.jpg");

    const camera = screen.getByLabelText("Take another photo");
    expect(screen.getByLabelText("Add from gallery")).toBeInTheDocument();
    await userEvent.upload(camera, new File(["y"], "second.jpg", { type: "image/jpeg" }));

    expect(await screen.findByAltText("second.jpg")).toBeInTheDocument();
    expect(screen.getByAltText("market.jpg")).toBeInTheDocument();
  });

  it("says Retry only after a failed save and returns to Save receipt on edit", async () => {
    const onSave = vi.fn().mockResolvedValue({ error: "Receipt photo was not uploaded. Try again." });
    render(
      <ReceiptCaptureForm suppliers={[]} isSaving={false} today="2026-10-05" onSave={onSave} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save receipt" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Add at least one photo.");
    expect(screen.getByRole("button", { name: "Save receipt" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();

    await addPhoto();
    await userEvent.click(screen.getByRole("button", { name: "Save receipt" }));
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Note"), "edited");
    expect(screen.getByRole("button", { name: "Save receipt" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("disables the fields and Remove while saving", async () => {
    const { rerender } = render(
      <ReceiptCaptureForm suppliers={[]} isSaving={false} today="2026-10-05" onSave={vi.fn()} />,
    );
    await addPhoto();
    rerender(
      <ReceiptCaptureForm suppliers={[]} isSaving today="2026-10-05" onSave={vi.fn()} />,
    );

    expect(screen.getByLabelText("Receipt date")).toBeDisabled();
    expect(screen.getByLabelText("Receipt total")).toBeDisabled();
    expect(screen.getByLabelText("Note")).toBeDisabled();
    expect(screen.getByLabelText("Supplier")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("stops at 10 pages", async () => {
    render(
      <ReceiptCaptureForm suppliers={[]} isSaving={false} today="2026-10-05" onSave={vi.fn()} />,
    );
    const input = screen.getByLabelText("Choose from gallery");
    const files = Array.from({ length: 11 }, (_, index) =>
      new File(["x"], `page-${index}.jpg`, { type: "image/jpeg" }),
    );
    await userEvent.upload(input, files);

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(10);
    });
    expect(screen.queryByRole("button", { name: "Add another page" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Take another photo")).toBeDisabled();
    expect(screen.getByLabelText("Add from gallery")).toBeDisabled();
    expect(screen.getByText("A receipt can have at most 10 photos.")).toBeInTheDocument();
  });
});
