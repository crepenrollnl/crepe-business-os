/**
 * Suppliers service (DEV-040).
 *
 * Orchestrates create_supplier, update_supplier, and deactivate_supplier only.
 * Does NOT generate supplier codes, enforce activation rules, or write suppliers
 * outside those RPCs.
 */

import { MAX_NAME_LENGTH, MAX_NOTES_LENGTH } from "@/constants/limits";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  CreateSupplierInput,
  CreateSupplierResult,
  DeactivateSupplierResult,
  UpdateSupplierInput,
  UpdateSupplierResult,
} from "../types/supplier";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function rpcErrorMessage(error: unknown): string | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }

  return typeof error === "string" ? error : null;
}

function optionalTrimmed(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateCreateSupplierInput(
  input: CreateSupplierInput,
): string | null {
  const name = input.name?.trim() ?? "";

  if (name.length === 0) {
    return "Supplier name is required.";
  }

  if (name.length > MAX_NAME_LENGTH) {
    return `Supplier name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  const notes = input.notes?.trim() ?? "";
  if (notes.length > MAX_NOTES_LENGTH) {
    return `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
  }

  return null;
}

function validateUpdateSupplierInput(
  input: UpdateSupplierInput,
): string | null {
  if (!input.supplier_id || !UUID_RE.test(input.supplier_id.trim())) {
    return "Supplier id is required.";
  }

  if (input.name !== undefined && input.name !== null) {
    const name = input.name.trim();
    if (name.length === 0) {
      return "Supplier name is required.";
    }
    if (name.length > MAX_NAME_LENGTH) {
      return `Supplier name must be ${MAX_NAME_LENGTH} characters or fewer.`;
    }
  }

  if (input.notes !== undefined && input.notes !== null) {
    if (input.notes.trim().length > MAX_NOTES_LENGTH) {
      return `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
    }
  }

  return null;
}

function validateDeactivateSupplierInput(supplierId: string): string | null {
  if (!supplierId || !UUID_RE.test(supplierId.trim())) {
    return "Supplier id is required.";
  }

  return null;
}

function mapSupplierRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("supplier name is required")) {
    return "Supplier name is required.";
  }

  if (normalized.includes("supplier id is required")) {
    return "Supplier id is required.";
  }

  if (normalized.includes("supplier was not found")) {
    return "Supplier was not found.";
  }

  if (
    normalized.includes("suppliers_code_key") ||
    (normalized.includes("duplicate") && normalized.includes("code"))
  ) {
    return "Could not generate a unique supplier code. Try again.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("create_supplier") ||
      normalized.includes("update_supplier") ||
      normalized.includes("deactivate_supplier")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Supplier management is not available yet. Apply the suppliers database script and try again.";
  }

  return null;
}

function mapSupplierError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapSupplierRpcError(message) : null;
    },
  });
}

function mapCreateSupplierRpcResult(
  data: unknown,
): CreateSupplierResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const supplierId = row.supplier_id;
  const code = row.code;

  if (
    typeof supplierId !== "string" ||
    !UUID_RE.test(supplierId) ||
    typeof code !== "string" ||
    code.trim().length === 0
  ) {
    return null;
  }

  return {
    supplierId,
    code,
  };
}

function mapUpdateSupplierRpcResult(
  data: unknown,
): UpdateSupplierResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const supplierId = row.supplier_id;

  if (typeof supplierId !== "string" || !UUID_RE.test(supplierId)) {
    return null;
  }

  return { supplierId };
}

function mapDeactivateSupplierRpcResult(
  data: unknown,
): DeactivateSupplierResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const supplierId = row.supplier_id;
  const isActive = row.is_active;
  const alreadyInactive = row.already_inactive;

  if (
    typeof supplierId !== "string" ||
    !UUID_RE.test(supplierId) ||
    isActive !== false ||
    typeof alreadyInactive !== "boolean"
  ) {
    return null;
  }

  return {
    supplierId,
    isActive: false,
    alreadyInactive,
  };
}

async function requireSignedIn(
  actionLabel: string,
): Promise<ServiceResult<true>> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return fail(`You must be signed in to ${actionLabel}.`);
  }

  return ok(true);
}

export const supplierService = {
  /**
   * Create a supplier via create_supplier RPC.
   * SQL owns insert + code generation.
   */
  async createSupplier(
    input: CreateSupplierInput,
  ): Promise<ServiceResult<CreateSupplierResult>> {
    try {
      const validationError = validateCreateSupplierInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const auth = await requireSignedIn("create a supplier");
      if (auth.error) {
        return fail(auth.error);
      }

      const { data, error } = await supabase.rpc("create_supplier", {
        p_name: input.name.trim(),
        p_contact_name: optionalTrimmed(input.contact_name),
        p_email: optionalTrimmed(input.email),
        p_phone: optionalTrimmed(input.phone),
        p_vat_number: optionalTrimmed(input.vat_number),
        p_notes: optionalTrimmed(input.notes),
      });

      if (error) {
        return fail(mapSupplierError(error, "Failed to create supplier."));
      }

      const rpcResult = mapCreateSupplierRpcResult(data);
      if (!rpcResult) {
        return fail("Supplier created but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapSupplierError(error, "Failed to create supplier."));
    }
  },

  /**
   * Update supplier profile fields via update_supplier RPC.
   * SQL owns persistence. Does not change is_active.
   */
  async updateSupplier(
    input: UpdateSupplierInput,
  ): Promise<ServiceResult<UpdateSupplierResult>> {
    try {
      const validationError = validateUpdateSupplierInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const auth = await requireSignedIn("update a supplier");
      if (auth.error) {
        return fail(auth.error);
      }

      const { data, error } = await supabase.rpc("update_supplier", {
        p_supplier_id: input.supplier_id.trim(),
        p_name: input.name === undefined ? null : input.name,
        p_contact_name:
          input.contact_name === undefined ? null : input.contact_name,
        p_email: input.email === undefined ? null : input.email,
        p_phone: input.phone === undefined ? null : input.phone,
        p_vat_number:
          input.vat_number === undefined ? null : input.vat_number,
        p_notes: input.notes === undefined ? null : input.notes,
      });

      if (error) {
        return fail(mapSupplierError(error, "Failed to update supplier."));
      }

      const rpcResult = mapUpdateSupplierRpcResult(data);
      if (!rpcResult) {
        return fail("Supplier updated but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapSupplierError(error, "Failed to update supplier."));
    }
  },

  /**
   * Soft-deactivate a supplier via deactivate_supplier RPC.
   * SQL owns is_active; historical purchases retain supplier_id.
   */
  async deactivateSupplier(
    supplierId: string,
  ): Promise<ServiceResult<DeactivateSupplierResult>> {
    try {
      const validationError = validateDeactivateSupplierInput(supplierId);
      if (validationError) {
        return fail(validationError);
      }

      const auth = await requireSignedIn("deactivate a supplier");
      if (auth.error) {
        return fail(auth.error);
      }

      const { data, error } = await supabase.rpc("deactivate_supplier", {
        p_supplier_id: supplierId.trim(),
      });

      if (error) {
        return fail(mapSupplierError(error, "Failed to deactivate supplier."));
      }

      const rpcResult = mapDeactivateSupplierRpcResult(data);
      if (!rpcResult) {
        return fail("Supplier deactivated but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapSupplierError(error, "Failed to deactivate supplier."));
    }
  },
};
