/**
 * Users service (DEV-049).
 *
 * Orchestrates create_user, update_user, deactivate_user, and assign_role only.
 * Does NOT authenticate, authorize, or write users/user_roles outside those RPCs.
 */

import { MAX_NAME_LENGTH } from "@/constants/limits";
import { toUserError } from "@/lib/service-errors";
import { supabase } from "@/lib/supabase";
import { fail, ok, type ServiceResult } from "@/types/service";
import type {
  AssignRoleInput,
  AssignRoleResult,
  CreateUserInput,
  CreateUserResult,
  DeactivateUserResult,
  UpdateUserInput,
  UpdateUserResult,
} from "../types/user";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_EMAIL_LENGTH = 254;

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

function validateCreateUserInput(input: CreateUserInput): string | null {
  const fullName = input.full_name?.trim() ?? "";
  if (fullName.length === 0) {
    return "User full name is required.";
  }
  if (fullName.length > MAX_NAME_LENGTH) {
    return `User full name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }

  const email = input.email?.trim() ?? "";
  if (email.length === 0) {
    return "User email is required.";
  }
  if (email.length > MAX_EMAIL_LENGTH) {
    return `User email must be ${MAX_EMAIL_LENGTH} characters or fewer.`;
  }

  return null;
}

function validateUpdateUserInput(input: UpdateUserInput): string | null {
  if (!input.user_id || !UUID_RE.test(input.user_id.trim())) {
    return "User id is required.";
  }

  if (input.full_name !== undefined && input.full_name !== null) {
    const fullName = input.full_name.trim();
    if (fullName.length === 0) {
      return "User full name is required.";
    }
    if (fullName.length > MAX_NAME_LENGTH) {
      return `User full name must be ${MAX_NAME_LENGTH} characters or fewer.`;
    }
  }

  if (input.email !== undefined && input.email !== null) {
    const email = input.email.trim();
    if (email.length === 0) {
      return "User email is required.";
    }
    if (email.length > MAX_EMAIL_LENGTH) {
      return `User email must be ${MAX_EMAIL_LENGTH} characters or fewer.`;
    }
  }

  return null;
}

function validateDeactivateUserInput(userId: string): string | null {
  if (!userId || !UUID_RE.test(userId.trim())) {
    return "User id is required.";
  }

  return null;
}

function validateAssignRoleInput(input: AssignRoleInput): string | null {
  if (!input.user_id || !UUID_RE.test(input.user_id.trim())) {
    return "User id is required.";
  }
  if (!input.role_id || !UUID_RE.test(input.role_id.trim())) {
    return "Role id is required.";
  }

  return null;
}

function mapUserRpcError(message: string): string | null {
  const normalized = message.toLowerCase();

  if (normalized.includes("user full name is required")) {
    return "User full name is required.";
  }

  if (normalized.includes("user email is required")) {
    return "User email is required.";
  }

  if (normalized.includes("user id is required")) {
    return "User id is required.";
  }

  if (normalized.includes("role id is required")) {
    return "Role id is required.";
  }

  if (normalized.includes("user was not found")) {
    return "User was not found.";
  }

  if (normalized.includes("role was not found")) {
    return "Role was not found.";
  }

  if (normalized.includes("email already exists")) {
    return "A user with this email already exists.";
  }

  if (normalized.includes("inactive users cannot be assigned roles")) {
    return "Inactive users cannot be assigned roles.";
  }

  if (
    normalized.includes("could not find the function") ||
    ((normalized.includes("create_user") ||
      normalized.includes("update_user") ||
      normalized.includes("deactivate_user") ||
      normalized.includes("assign_role")) &&
      (normalized.includes("schema cache") ||
        normalized.includes("does not exist") ||
        normalized.includes("42883")))
  ) {
    return "User management is not available yet. Apply the users & roles database script and try again.";
  }

  return null;
}

function mapUserError(error: unknown, fallback: string): string {
  return toUserError(error, fallback, {
    map: (err) => {
      const message = rpcErrorMessage(err);
      return message ? mapUserRpcError(message) : null;
    },
  });
}

function mapCreateUserRpcResult(data: unknown): CreateUserResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const userId = row.user_id;

  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    return null;
  }

  return { userId };
}

function mapUpdateUserRpcResult(data: unknown): UpdateUserResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const userId = row.user_id;

  if (typeof userId !== "string" || !UUID_RE.test(userId)) {
    return null;
  }

  return { userId };
}

function mapDeactivateUserRpcResult(
  data: unknown,
): DeactivateUserResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const userId = row.user_id;
  const isActive = row.is_active;
  const alreadyInactive = row.already_inactive;

  if (
    typeof userId !== "string" ||
    !UUID_RE.test(userId) ||
    isActive !== false ||
    typeof alreadyInactive !== "boolean"
  ) {
    return null;
  }

  return {
    userId,
    isActive: false,
    alreadyInactive,
  };
}

function mapAssignRoleRpcResult(data: unknown): AssignRoleResult | null {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const row = data as Record<string, unknown>;
  const userId = row.user_id;
  const roleId = row.role_id;
  const roleCode = row.role_code;
  const alreadyAssigned = row.already_assigned;

  if (
    typeof userId !== "string" ||
    !UUID_RE.test(userId) ||
    typeof roleId !== "string" ||
    !UUID_RE.test(roleId) ||
    typeof roleCode !== "string" ||
    roleCode.trim().length === 0 ||
    typeof alreadyAssigned !== "boolean"
  ) {
    return null;
  }

  return {
    userId,
    roleId,
    roleCode,
    alreadyAssigned,
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

export const userService = {
  /**
   * Create a user via create_user RPC.
   */
  async createUser(
    input: CreateUserInput,
  ): Promise<ServiceResult<CreateUserResult>> {
    try {
      const validationError = validateCreateUserInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const auth = await requireSignedIn("create a user");
      if (auth.error) {
        return fail(auth.error);
      }

      const { data, error } = await supabase.rpc("create_user", {
        p_full_name: input.full_name.trim(),
        p_email: input.email.trim(),
      });

      if (error) {
        return fail(mapUserError(error, "Failed to create user."));
      }

      const rpcResult = mapCreateUserRpcResult(data);
      if (!rpcResult) {
        return fail("User created but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapUserError(error, "Failed to create user."));
    }
  },

  /**
   * Update user profile fields via update_user RPC.
   */
  async updateUser(
    input: UpdateUserInput,
  ): Promise<ServiceResult<UpdateUserResult>> {
    try {
      const validationError = validateUpdateUserInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const auth = await requireSignedIn("update a user");
      if (auth.error) {
        return fail(auth.error);
      }

      const { data, error } = await supabase.rpc("update_user", {
        p_user_id: input.user_id.trim(),
        p_full_name: input.full_name === undefined ? null : input.full_name,
        p_email: input.email === undefined ? null : input.email,
      });

      if (error) {
        return fail(mapUserError(error, "Failed to update user."));
      }

      const rpcResult = mapUpdateUserRpcResult(data);
      if (!rpcResult) {
        return fail("User updated but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapUserError(error, "Failed to update user."));
    }
  },

  /**
   * Soft-deactivate a user via deactivate_user RPC.
   */
  async deactivateUser(
    userId: string,
  ): Promise<ServiceResult<DeactivateUserResult>> {
    try {
      const validationError = validateDeactivateUserInput(userId);
      if (validationError) {
        return fail(validationError);
      }

      const auth = await requireSignedIn("deactivate a user");
      if (auth.error) {
        return fail(auth.error);
      }

      const { data, error } = await supabase.rpc("deactivate_user", {
        p_user_id: userId.trim(),
      });

      if (error) {
        return fail(mapUserError(error, "Failed to deactivate user."));
      }

      const rpcResult = mapDeactivateUserRpcResult(data);
      if (!rpcResult) {
        return fail("User deactivated but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapUserError(error, "Failed to deactivate user."));
    }
  },

  /**
   * Assign a role to a user via assign_role RPC.
   */
  async assignRole(
    input: AssignRoleInput,
  ): Promise<ServiceResult<AssignRoleResult>> {
    try {
      const validationError = validateAssignRoleInput(input);
      if (validationError) {
        return fail(validationError);
      }

      const auth = await requireSignedIn("assign a role");
      if (auth.error) {
        return fail(auth.error);
      }

      const { data, error } = await supabase.rpc("assign_role", {
        p_user_id: input.user_id.trim(),
        p_role_id: input.role_id.trim(),
      });

      if (error) {
        return fail(mapUserError(error, "Failed to assign role."));
      }

      const rpcResult = mapAssignRoleRpcResult(data);
      if (!rpcResult) {
        return fail("Role assigned but the response was invalid.");
      }

      return ok(rpcResult);
    } catch (error) {
      return fail(mapUserError(error, "Failed to assign role."));
    }
  },
};
