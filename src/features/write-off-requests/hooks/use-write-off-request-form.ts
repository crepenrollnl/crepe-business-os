"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { parseNumericInput } from "@/components/ui/numeric-input";
import type { WriteOffReason } from "@/features/write-offs/types/write-off";
import { useAsyncEffect } from "@/hooks/use-async-effect";
import { writeOffRequestService } from "../services/write-off-request-service";
import type {
  WriteOffRequestItemOption,
  WriteOffRequestItemOptions,
  WriteOffRequestItemType,
} from "../types/write-off-request";
import { notifyWriteOffRequestsChanged } from "../utils/write-off-request-events";

export interface WriteOffRequestDraft {
  itemType: WriteOffRequestItemType;
  search: string;
  itemId: string;
  quantity: string;
  reason: WriteOffReason;
  note: string;
}

const EMPTY_OPTIONS: WriteOffRequestItemOptions = {
  dish: [],
  finished_good: [],
  ingredient: [],
};

function emptyDraft(): WriteOffRequestDraft {
  return {
    itemType: "dish",
    search: "",
    itemId: "",
    quantity: "",
    reason: "spoilage",
    note: "",
  };
}

/**
 * The request form: cost-free item options, the draft and submit. One
 * client request id per attempt — reused when the same attempt is sent
 * again (e.g. after a network error), new after a success — so a retry can
 * never create a second request (sql/157).
 */
export function useWriteOffRequestForm(options?: { onSubmitted?: () => void }) {
  const onSubmitted = options?.onSubmitted;
  const [itemOptions, setItemOptions] =
    useState<WriteOffRequestItemOptions>(EMPTY_OPTIONS);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [draft, setDraft] = useState<WriteOffRequestDraft>(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const clientRequestIdRef = useRef<string | null>(null);

  const loadOptions = useCallback(async () => {
    setOptionsLoading(true);
    const result = await writeOffRequestService.listItemOptions();
    if (result.error || !result.data) {
      setOptionsError(result.error ?? "Failed to load items");
      setOptionsLoading(false);
      return;
    }
    setItemOptions(result.data);
    setOptionsError(null);
    setOptionsLoading(false);
  }, []);

  useAsyncEffect(loadOptions, [loadOptions]);

  const updateField = useCallback(
    <K extends keyof WriteOffRequestDraft>(field: K, value: WriteOffRequestDraft[K]) => {
      setSuccess(null);
      setDraft((current) => ({ ...current, [field]: value }));
    },
    [],
  );

  const setItemType = useCallback((itemType: WriteOffRequestItemType) => {
    setSuccess(null);
    setDraft((current) => ({ ...current, itemType, itemId: "", search: "" }));
  }, []);

  const filteredOptions = useMemo<WriteOffRequestItemOption[]>(() => {
    const search = draft.search.trim().toLowerCase();
    const all = itemOptions[draft.itemType];
    return search.length === 0
      ? all
      : all.filter((option) => option.name.toLowerCase().includes(search));
  }, [draft.itemType, draft.search, itemOptions]);

  const selectedItem = useMemo(
    () =>
      itemOptions[draft.itemType].find((option) => option.id === draft.itemId) ??
      null,
    [draft.itemId, draft.itemType, itemOptions],
  );

  const submit = useCallback(async () => {
    setSubmitError(null);
    setSuccess(null);

    const quantity = parseNumericInput(draft.quantity);
    if (!draft.itemId) {
      setSubmitError("Choose the item to write off.");
      return false;
    }
    if (quantity === null || quantity <= 0) {
      setSubmitError("Write-off quantity must be greater than zero.");
      return false;
    }

    clientRequestIdRef.current ??= crypto.randomUUID();

    setSubmitting(true);
    const result = await writeOffRequestService.requestWriteOff({
      item_type: draft.itemType,
      item_id: draft.itemId,
      quantity,
      reason: draft.reason,
      note: draft.note.trim() ? draft.note.trim() : null,
      client_request_id: clientRequestIdRef.current,
    });
    setSubmitting(false);

    if (result.error || !result.data) {
      // Same attempt: the next submit reuses the same request id.
      setSubmitError(result.error ?? "Failed to send the write-off request");
      return false;
    }

    clientRequestIdRef.current = null;
    setDraft((current) => ({ ...emptyDraft(), itemType: current.itemType }));
    setSuccess("Request sent — waiting for approval");
    notifyWriteOffRequestsChanged();
    onSubmitted?.();
    return true;
  }, [draft, onSubmitted]);

  return {
    draft,
    itemOptions,
    filteredOptions,
    selectedItem,
    optionsLoading,
    optionsError,
    submitting,
    submitError,
    success,
    updateField,
    setItemType,
    submit,
    retryOptions: loadOptions,
  };
}
