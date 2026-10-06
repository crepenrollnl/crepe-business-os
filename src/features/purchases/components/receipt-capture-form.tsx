"use client";

import { useEffect, useRef, useState } from "react";
import { parseNumericInput, sanitizeNumericInput } from "@/components/ui/numeric-input";
import {
  PURCHASE_RECEIPT_MAX_PAGES,
  type PurchaseReceiptPageInput,
  type PurchaseReceiptSupplierOption,
} from "../types/purchase-receipt";
import { amsterdamToday } from "../utils/amsterdam-date";
import { prepareReceiptImage } from "../utils/prepare-receipt-image";

export interface ReceiptCaptureValues {
  receiptDate: string;
  supplierId: string | null;
  receiptTotal: number | null;
  note: string | null;
  pages: PurchaseReceiptPageInput[];
}

interface PageDraft {
  key: string;
  previewUrl: string;
  blob: Blob;
  originalFilename: string | null;
}

interface ReceiptCaptureFormProps {
  suppliers: PurchaseReceiptSupplierOption[];
  isSaving: boolean;
  today?: string;
  onSave: (values: ReceiptCaptureValues) => Promise<{ error: string | null }>;
}

const fieldClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-3 text-base text-zinc-900 shadow-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20";

export function ReceiptCaptureForm({
  suppliers,
  isSaving,
  today,
  onSave,
}: ReceiptCaptureFormProps) {
  const [pages, setPages] = useState<PageDraft[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [receiptDate, setReceiptDate] = useState(today ?? amsterdamToday());
  const [receiptTotal, setReceiptTotal] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const savingRef = useRef(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const pagesRef = useRef(pages);

  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  useEffect(() => {
    return () => {
      for (const page of pagesRef.current) {
        URL.revokeObjectURL(page.previewUrl);
      }
    };
  }, []);

  const atPageLimit = pages.length >= PURCHASE_RECEIPT_MAX_PAGES;
  const cameraLabel = pages.length > 0 ? "Take another photo" : "Take photo";
  const galleryLabel = pages.length > 0 ? "Add from gallery" : "Choose from gallery";

  function markEdited() {
    setSaveFailed(false);
  }

  async function addFiles(fileList: FileList | null) {
    const selected = fileList ? Array.from(fileList) : [];
    if (selected.length === 0) {
      return;
    }

    setIsPreparing(true);
    setError(null);
    markEdited();
    const next: PageDraft[] = [];
    let room = PURCHASE_RECEIPT_MAX_PAGES - pages.length;
    let prepareError: string | null = null;

    for (const file of selected) {
      if (room <= 0) {
        break;
      }
      const prepared = await prepareReceiptImage(file);
      if (!prepared.ok) {
        prepareError = prepared.error;
        break;
      }
      next.push({
        key: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(prepared.blob),
        blob: prepared.blob,
        originalFilename: prepared.originalFilename,
      });
      room -= 1;
    }

    setPages((current) => [...current, ...next]);
    setError(prepareError);
    setIsPreparing(false);
  }

  function removePage(key: string) {
    setPages((current) => {
      const page = current.find((item) => item.key === key);
      if (page) {
        URL.revokeObjectURL(page.previewUrl);
      }
      return current.filter((item) => item.key !== key);
    });
    markEdited();
  }

  async function handleSave() {
    if (savingRef.current || isSaving || isPreparing) {
      return;
    }

    if (pages.length === 0) {
      setError("Add at least one photo.");
      return;
    }

    if (receiptDate.trim().length === 0) {
      setError("Receipt date is required.");
      return;
    }

    const trimmedTotal = receiptTotal.trim();
    let parsedTotal: number | null = null;
    if (trimmedTotal.length > 0) {
      parsedTotal = parseNumericInput(trimmedTotal);
      if (parsedTotal === null) {
        setError("Enter a valid receipt total.");
        return;
      }
      if (parsedTotal < 0) {
        setError("Receipt total cannot be negative.");
        return;
      }
    }

    const trimmedNote = note.trim();
    savingRef.current = true;
    setError(null);

    try {
      const result = await onSave({
        receiptDate,
        supplierId: supplierId.length > 0 ? supplierId : null,
        receiptTotal: parsedTotal,
        note: trimmedNote.length > 0 ? trimmedNote : null,
        pages: pages.map((page) => ({
          blob: page.blob,
          originalFilename: page.originalFilename,
        })),
      });

      if (result.error) {
        setError(result.error);
        setSaveFailed(true);
        return;
      }
      setSaveFailed(false);

      for (const page of pages) {
        URL.revokeObjectURL(page.previewUrl);
      }
      setPages([]);
      setSupplierId("");
      setReceiptDate(today ?? amsterdamToday());
      setReceiptTotal("");
      setNote("");
      setError(null);
    } finally {
      savingRef.current = false;
    }
  }

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-lg bg-amber-500 px-4 text-base font-semibold text-white hover:bg-amber-600">
          {cameraLabel}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={atPageLimit || isPreparing || isSaving}
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
        <label className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 text-base font-semibold text-zinc-900 hover:bg-zinc-50">
          {galleryLabel}
          <input
            ref={galleryRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            disabled={atPageLimit || isPreparing || isSaving}
            onChange={(event) => {
              void addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </label>
      </div>

      {pages.length > 0 ? (
        <div className="space-y-3">
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {pages.map((page, index) => (
              <li key={page.key} className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- blob preview, not a static asset */}
                <img
                  src={page.previewUrl}
                  alt={page.originalFilename ?? `Page ${index + 1}`}
                  className="aspect-[3/4] w-full rounded-lg object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePage(page.key)}
                  disabled={isSaving}
                  className="min-h-10 w-full rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {atPageLimit ? (
            <p className="text-sm text-zinc-600">A receipt can have at most 10 photos.</p>
          ) : null}
        </div>
      ) : null}

      <label className="block space-y-1 text-sm font-medium text-zinc-700">
        Supplier
        <select
          value={supplierId}
          disabled={isSaving}
          onChange={(event) => {
            markEdited();
            setSupplierId(event.target.value);
          }}
          className={fieldClassName}
        >
          <option value="">No supplier</option>
          {suppliers.map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1 text-sm font-medium text-zinc-700">
        Receipt date
        <input
          type="date"
          required
          disabled={isSaving}
          value={receiptDate}
          onChange={(event) => {
            markEdited();
            setReceiptDate(event.target.value);
          }}
          className={fieldClassName}
        />
      </label>

      <label className="block space-y-1 text-sm font-medium text-zinc-700">
        Receipt total
        <input
          inputMode="decimal"
          disabled={isSaving}
          value={receiptTotal}
          onChange={(event) => {
            markEdited();
            setReceiptTotal(sanitizeNumericInput(event.target.value));
          }}
          placeholder="0,00"
          className={fieldClassName}
        />
      </label>

      <label className="block space-y-1 text-sm font-medium text-zinc-700">
        Note
        <textarea
          disabled={isSaving}
          value={note}
          onChange={(event) => {
            markEdited();
            setNote(event.target.value);
          }}
          rows={2}
          className={fieldClassName}
        />
      </label>

      {error ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={isSaving || isPreparing}
        className="min-h-12 w-full rounded-lg bg-zinc-900 px-4 text-base font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSaving ? "Saving…" : saveFailed ? "Retry" : "Save receipt"}
      </button>
    </section>
  );
}
