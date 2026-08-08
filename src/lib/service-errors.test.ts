import { describe, expect, it } from "vitest";
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
