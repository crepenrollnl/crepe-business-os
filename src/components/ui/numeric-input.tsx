"use client";

import type { FocusEvent, WheelEvent } from "react";

export function sanitizeNumericInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, "");

  if (cleaned.length === 0) {
    return "";
  }

  let separator: "." | "," | null = null;
  let integerPart = "";
  let fractionPart = "";

  for (const char of cleaned) {
    if (char === "." || char === ",") {
      if (separator === null) {
        separator = char;
      }
      continue;
    }

    if (separator === null) {
      integerPart += char;
    } else {
      fractionPart += char;
    }
  }

  if (integerPart.length > 1) {
    integerPart = integerPart.replace(/^0+(?=\d)/, "");
  }

  if (integerPart.length === 0 && separator !== null) {
    integerPart = "0";
  }

  if (separator === null) {
    return integerPart;
  }

  return `${integerPart}${separator}${fractionPart}`;
}

export function parseNumericInput(raw: string): number | null {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.replace(",", ".");

  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return null;
  }

  const value = Number(normalized);

  if (!Number.isFinite(value)) {
    return null;
  }

  return value;
}

export function formatNumericInput(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

const defaultClassName =
  "block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

export interface NumericInputProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: (event: FocusEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
}

export function NumericInput({
  id,
  name,
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  className,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
}: NumericInputProps) {
  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    event.currentTarget.select();
  };

  const handleWheel = (event: WheelEvent<HTMLInputElement>) => {
    // type="text" does not change on wheel; blur avoids accidental focus side effects
    event.currentTarget.blur();
  };

  return (
    <input
      id={id}
      name={name}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(event) => onChange(sanitizeNumericInput(event.target.value))}
      onFocus={handleFocus}
      onBlur={onBlur}
      onWheel={handleWheel}
      disabled={disabled}
      placeholder={placeholder}
      className={className ? `${defaultClassName} ${className}` : defaultClassName}
      aria-invalid={ariaInvalid}
      aria-label={ariaLabel}
    />
  );
}
