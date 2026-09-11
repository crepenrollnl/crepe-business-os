import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isDeleteBlockedByReference,
  extractReferencingTable,
  mapDeletionBlockedByReference,
  toUserError,
} from "./service-errors";

const DELETE_BLOCKED_ERROR = {
  code: "23503",
  message:
    'update or delete on table "ingredients" violates foreign key constraint "purchase_items_ingredient_id_fkey" on table "purchase_items"',
};

const INSERT_BLOCKED_ERROR = {
  code: "23503",
  message:
    'insert or update on table "recipe_items" violates foreign key constraint "recipe_items_ingredient_id_fkey"\nDETAIL: Key (ingredient_id)=(...) is not present in table "ingredients".',
};

describe("toUserError", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("passes through our own deliberately-raised business message unchanged (regression guard)", () => {
    // No .code at all, same shape as our own RPC-raised errors and thrown
    // validation Errors are commonly mocked with in this codebase's tests.
    const error = { message: "This purchase has already been received." };

    expect(toUserError(error, "Failed to receive purchase")).toBe(
      "This purchase has already been received.",
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("passes through a plain thrown JS Error with unrelated text unchanged (regression guard)", () => {
    const error = new Error("connection lost");

    expect(toUserError(error, "Failed to delete recipe")).toBe(
      "connection lost",
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("blocks a genuine RLS policy violation and logs it", () => {
    const error = {
      message: 'new row violates row-level security policy for table "sales"',
    };

    expect(toUserError(error, "Failed to save sale")).toBe(
      "Failed to save sale",
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "ServiceErrorSuppressed",
      expect.objectContaining({ fallback: "Failed to save sale", error }),
    );
  });

  it("blocks a NOT NULL constraint violation and logs it", () => {
    const error = {
      message:
        'null value in column "cost_per_unit" of relation "ingredients" violates not-null constraint',
    };

    expect(toUserError(error, "Failed to save ingredient")).toBe(
      "Failed to save ingredient",
    );
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("blocks a foreign key constraint violation and logs it", () => {
    const error = {
      message:
        'insert or update on table "purchase_items" violates foreign key constraint "purchase_items_ingredient_id_fkey"',
    };

    expect(toUserError(error, "Failed to save purchase")).toBe(
      "Failed to save purchase",
    );
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("blocks a CHECK constraint violation and logs it", () => {
    const error = {
      message:
        'new row for relation "purchase_items" violates check constraint "purchase_items_unit_cost_check"',
    };

    expect(toUserError(error, "Failed to save purchase")).toBe(
      "Failed to save purchase",
    );
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("blocks a duplicate-key unique constraint violation and logs it", () => {
    const error = {
      message:
        'duplicate key value violates unique constraint "sales_sale_number_key"',
    };

    expect(toUserError(error, "Failed to create sale")).toBe(
      "Failed to create sale",
    );
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("blocks a 'permission denied for' message and logs it", () => {
    const error = { message: "permission denied for table sale_lines" };

    expect(toUserError(error, "Failed to load sold quantities")).toBe(
      "Failed to load sold quantities",
    );
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("still substitutes the generic network message before the raw-Postgres check", () => {
    const error = { message: "Failed to fetch" };

    expect(toUserError(error, "Failed to save")).toBe(
      "Network error. Please check your connection and try again.",
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("falls back (without logging) when there is no usable message at all", () => {
    expect(toUserError({}, "Failed to save")).toBe("Failed to save");
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("still honors a domain map override before the raw-Postgres check", () => {
    const error = {
      message:
        'update or delete on table "ingredients" violates foreign key constraint "purchase_items_ingredient_id_fkey" on table "purchase_items"',
    };

    expect(
      toUserError(error, "fallback", { map: () => "Domain-specific message" }),
    ).toBe("Domain-specific message");
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});

describe("isDeleteBlockedByReference", () => {
  it("is true for a delete rejected because another row still references it", () => {
    expect(isDeleteBlockedByReference(DELETE_BLOCKED_ERROR)).toBe(true);
  });

  it("is false for an insert/update rejected by a missing parent row (same SQLSTATE, different meaning)", () => {
    expect(isDeleteBlockedByReference(INSERT_BLOCKED_ERROR)).toBe(false);
  });

  it("is false for an unrelated error", () => {
    expect(isDeleteBlockedByReference({ message: "network error" })).toBe(
      false,
    );
  });

  it("is false for null/undefined", () => {
    expect(isDeleteBlockedByReference(null)).toBe(false);
    expect(isDeleteBlockedByReference(undefined)).toBe(false);
  });
});

describe("extractReferencingTable", () => {
  it("extracts the table still holding the reference", () => {
    expect(extractReferencingTable(DELETE_BLOCKED_ERROR)).toBe(
      "purchase_items",
    );
  });

  it("returns null when the message doesn't match the delete-blocked shape", () => {
    expect(extractReferencingTable(INSERT_BLOCKED_ERROR)).toBeNull();
    expect(extractReferencingTable({ message: "boom" })).toBeNull();
  });
});

describe("mapDeletionBlockedByReference", () => {
  it("returns the table-specific message when the referencing table is mapped", () => {
    const mapper = mapDeletionBlockedByReference({
      fallback: "This item is used elsewhere and cannot be deleted.",
      byTable: {
        purchase_items: "This item is used in purchases and cannot be deleted.",
      },
    });

    expect(mapper(DELETE_BLOCKED_ERROR)).toBe(
      "This item is used in purchases and cannot be deleted.",
    );
  });

  it("falls back to the generic message for an unmapped referencing table", () => {
    const mapper = mapDeletionBlockedByReference({
      fallback: "This item is used elsewhere and cannot be deleted.",
      byTable: {
        recipe_items: "This item is used in recipes and cannot be deleted.",
      },
    });

    expect(mapper(DELETE_BLOCKED_ERROR)).toBe(
      "This item is used elsewhere and cannot be deleted.",
    );
  });

  it("returns null for anything that isn't a delete-blocked-by-reference error, so it composes with other mappers", () => {
    const mapper = mapDeletionBlockedByReference({
      fallback: "This item is used elsewhere and cannot be deleted.",
    });

    expect(mapper(INSERT_BLOCKED_ERROR)).toBeNull();
    expect(mapper({ message: "network error" })).toBeNull();
  });

  it("composes with toUserError's map option end-to-end", () => {
    const message = toUserError(DELETE_BLOCKED_ERROR, "Failed to delete", {
      map: mapDeletionBlockedByReference({
        fallback: "This item is used elsewhere and cannot be deleted.",
        byTable: {
          purchase_items:
            "This item is used in purchases and cannot be deleted.",
        },
      }),
    });

    expect(message).toBe(
      "This item is used in purchases and cannot be deleted.",
    );
  });
});
