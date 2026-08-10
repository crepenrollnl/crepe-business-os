/**
 * Customers service (DEV-039).
 *
 * Orchestrates create_customer, update_customer, and deactivate_customer only.
 * Does NOT generate customer codes, enforce activation rules, or write customers
 * outside those RPCs.
 */

import { MAX_NAME_LENGTH, MAX_NOTES_LENGTH } from "@/constants/limits";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  CreateCustomerInput,
  CreateCustomerResult,
  DeactivateCustomerResult,
  UpdateCustomerInput,
  UpdateCustomerResult,
} from "../types/customer";

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

function validateCreateCustomerInput(
  input: CreateCustomerInput,
): string | null {
  const name = input.name?.trim() ?? "";

  if (name.length === 0) {
    return "Customer name is required.";
  }

  if (name.length > MAX_NAME_LENGTH) {
    return `Customer name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  const notes = input.notes?.trim() ?? "";
  if (notes.length > MAX_NOTES_LENGTH) {
    return `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
  }

  return null;
}

function validateUpdateCustomerInput(
  input: UpdateCustomerInput,
): string | null {
  if (!input.customer_id || !UUID_RE.test(input.customer_id.trim())) {
    return "Customer id is required.";
  }

  if (input.name !== undefined && input.name !== null) {
    const name = input.name.trim();
    if (name.length === 0) {
      return "Customer name is required.";
    }
    if (name.length > MAX_NAME_LENGTH) {
      return `Customer name must be ${MAX_NAME_LENGTH} characters or fewer.`;
    }
  }

  if (input.notes !== undefined && input.notes !== null) {
    if (input.notes.trim().length > MAX_NOTES_LENGTH) {
      return `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`;
    }
  }

  return null;
}

function validateDeactivateCustomerInput(customerId: string): string | null {
  if (!customerId || !UUID_RE.test(customerId.trim())) {
    return "Customer id is required.";
  }

  return null;
}

function mapCustomerRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("customer name is required")) {
    return "Customer name is required.";
  }

  if (normalized.includes("customer id is required")) {
    return "Customer id is required.";
  }

  if (normalized.includes("customer was not found")) {
    return "Customer was not found.";
  }

  if (
    normalized.includes("customers_code_key") ||
    (normalized.includes("duplicate") && normalized.includes("code"))
  ) {
    return "Could not generate a unique customer code. Try again.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("create_customer") ||
      normalized.includes("update_customer") ||
      normalized.includes("deactivate_customer")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "Customer management is not available yet. Apply the customers database script and try again.";
  }

  return null;
}

function mapCustomerError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapCustomerRpcError(message) : null;
    },
  });
}

function mapCreateCustomerRpcResult(
  data: unknown,
): CreateCustomerResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const customerId = row.customer_id;
  const code = row.code;

  if (
    typeof customerId !== "string" ||
    !UUID_RE.test(customerId) ||
    typeof code !== "string" ||
    code.trim().length === 0
  ) {
    return null;
  }

  return {
    customerId,
    code,
  };
}

function mapUpdateCustomerRpcResult(
  data: unknown,
): UpdateCustomerResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const customerId = row.customer_id;

  if (typeof customerId !== "string" || !UUID_RE.test(customerId)) {
    return null;
  }

  return { customerId };
}

function mapDeactivateCustomerRpcResult(
  data: unknown,
): DeactivateCustomerResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const customerId = row.customer_id;
  const isActive = row.is_active;
  const alreadyInactive = row.already_inactive;

  if (
    typeof customerId !== "string" ||
    !UUID_RE.test(customerId) ||
    isActive !== false ||
    typeof alreadyInactive !== "boolean"
  ) {
    return null;
  }

  return {
    customerId,
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

export const customerService = {
  /**
   * Create a customer via create_customer RPC.
   * SQL owns insert + code generation.
   */
  async createCustomer(
    input: CreateCustomerInput,
  ): Promise<ServiceResult<CreateCustomerResult>> {
    try {
      const validationError = validateCreateCustomerInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const auth = await requireSignedIn("create a customer");
      if (auth.error) {
        return fail(auth.error);
      }

      const { data, error } = await supabase.rpc("create_customer", {
        p_name: input.name.trim(),
        p_email: optionalTrimmed(input.email),
        p_phone: optionalTrimmed(input.phone),
        p_vat_number: optionalTrimmed(input.vat_number),
        p_notes: optionalTrimmed(input.notes),
      });

      if (error) {
        return fail(mapCustomerError(error, "Failed to create customer."));
      }

      const rpcResult = mapCreateCustomerRpcResult(data);
      if (!rpcResult) {
        return fail("Customer created but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapCustomerError(error, "Failed to create customer."));
    }
  },

  /**
   * Update customer profile fields via update_customer RPC.
   * SQL owns persistence. Does not change is_active.
   */
  async updateCustomer(
    input: UpdateCustomerInput,
  ): Promise<ServiceResult<UpdateCustomerResult>> {
    try {
      const validationError = validateUpdateCustomerInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const auth = await requireSignedIn("update a customer");
      if (auth.error) {
        return fail(auth.error);
      }

      const { data, error } = await supabase.rpc("update_customer", {
        p_customer_id: input.customer_id.trim(),
        p_name: input.name === undefined ? null : input.name,
        p_email: input.email === undefined ? null : input.email,
        p_phone: input.phone === undefined ? null : input.phone,
        p_vat_number:
          input.vat_number === undefined ? null : input.vat_number,
        p_notes: input.notes === undefined ? null : input.notes,
      });

      if (error) {
        return fail(mapCustomerError(error, "Failed to update customer."));
      }

      const rpcResult = mapUpdateCustomerRpcResult(data);
      if (!rpcResult) {
        return fail("Customer updated but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapCustomerError(error, "Failed to update customer."));
    }
  },

  /**
   * Soft-deactivate a customer via deactivate_customer RPC.
   * SQL owns is_active; historical sales retain customer_id.
   */
  async deactivateCustomer(
    customerId: string,
  ): Promise<ServiceResult<DeactivateCustomerResult>> {
    try {
      const validationError = validateDeactivateCustomerInput(customerId);
      if (validationError) {
        return fail(validationError);
      }

      const auth = await requireSignedIn("deactivate a customer");
      if (auth.error) {
        return fail(auth.error);
      }

      const { data, error } = await supabase.rpc("deactivate_customer", {
        p_customer_id: customerId.trim(),
      });

      if (error) {
        return fail(mapCustomerError(error, "Failed to deactivate customer."));
      }

      const rpcResult = mapDeactivateCustomerRpcResult(data);
      if (!rpcResult) {
        return fail("Customer deactivated but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapCustomerError(error, "Failed to deactivate customer."));
    }
  },
};
